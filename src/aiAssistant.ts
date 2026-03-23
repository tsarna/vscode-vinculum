import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { marked } from 'marked';

// ── Venv management ───────────────────────────────────────────────────────────
//
// The extension maintains its own Python venv under globalStorageUri so it is
// isolated from the user's system Python (important on macOS/Homebrew where
// PEP 668 blocks bare pip installs).
//
// Layout:
//   {globalStorageUri}/
//     venv/          ← created by `python3 -m venv`
//       bin/python   ← always used for CLI invocations
//       .installed   ← marker file written after successful pip install

// Cached promise — concurrent calls share the same setup work.
let _venvReady: Promise<string> | undefined;

function venvPythonPath(globalStoragePath: string): string {
  const bin = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
  return path.join(globalStoragePath, 'venv', bin);
}

function venvMarkerPath(globalStoragePath: string): string {
  return path.join(globalStoragePath, 'venv', '.installed');
}

/** Run a command as a child process, resolving on exit 0, rejecting otherwise. */
function spawnToPromise(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = cp.spawn(cmd, args, { env: env ?? process.env });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) { resolve(); }
      else { reject(new Error(stderr.trim() || `Process exited with code ${code}`)); }
    });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      const hint = err.code === 'ENOENT'
        ? `\nCould not find "${cmd}". Set a custom path in Settings → Vinculum › Python Path.`
        : '';
      reject(new Error(err.message + hint));
    });
  });
}

/**
 * Ensure the managed venv exists and has all deps installed.
 * Returns the path to the venv Python executable.
 * Result is cached for the lifetime of the extension process.
 */
function ensureVenv(extensionPath: string, globalStoragePath: string): Promise<string> {
  if (_venvReady) { return _venvReady; }

  _venvReady = _doEnsureVenv(extensionPath, globalStoragePath).catch((err) => {
    _venvReady = undefined; // allow retry on next call
    throw err;
  });
  return _venvReady;
}

async function _doEnsureVenv(extensionPath: string, globalStoragePath: string): Promise<string> {
  const pythonBin = venvPythonPath(globalStoragePath);
  const marker = venvMarkerPath(globalStoragePath);

  if (fs.existsSync(marker)) {
    return pythonBin; // already set up
  }

  const config = vscode.workspace.getConfiguration('vinculum');
  const systemPython = config.get<string>('pythonPath', 'python3');
  const venvDir = path.join(globalStoragePath, 'venv');
  const requirementsTxt = path.join(extensionPath, 'python', 'requirements.txt');
  const pip = path.join(globalStoragePath, 'venv',
    process.platform === 'win32' ? 'Scripts/pip.exe' : 'bin/pip');

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Vinculum AI', cancellable: false },
    async (progress) => {
      progress.report({ message: 'Creating Python environment…' });
      fs.mkdirSync(globalStoragePath, { recursive: true });
      await spawnToPromise(systemPython, ['-m', 'venv', venvDir]);

      progress.report({ message: 'Installing dependencies (first run, may take a minute)…' });
      await spawnToPromise(pip, ['install', '-q', '-r', requirementsTxt]);

      fs.writeFileSync(marker, new Date().toISOString());
    },
  );

  return pythonBin;
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export class AiAssistantPanel {
  public static currentPanel: AiAssistantPanel | undefined;
  private static readonly viewType = 'vinculumAI';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _context: vscode.ExtensionContext;
  private readonly _disposables: vscode.Disposable[] = [];
  private _activeProc: cp.ChildProcess | undefined;

  // ── Static API ────────────────────────────────────────────────────────────

  public static createOrShow(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (AiAssistantPanel.currentPanel) {
      AiAssistantPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      AiAssistantPanel.viewType,
      'Vinculum AI',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    AiAssistantPanel.currentPanel = new AiAssistantPanel(panel, context);
  }

  public static async clearDocCache(context: vscode.ExtensionContext): Promise<void> {
    const globalStoragePath = context.globalStorageUri.fsPath;
    let pythonBin: string;
    try {
      pythonBin = await ensureVenv(context.extensionPath, globalStoragePath);
    } catch (err) {
      vscode.window.showErrorMessage(`Vinculum AI: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Vinculum AI: Refreshing index…', cancellable: false },
      () => spawnToPromise(pythonBin, ['-m', 'vinculum_ai', '--refresh-index'], {
        ...process.env,
        PYTHONPATH: path.join(context.extensionPath, 'python'),
      }).catch(() => { /* non-fatal */ }),
    );
  }

  // ── Constructor ───────────────────────────────────────────────────────────

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this._panel = panel;
    this._context = context;

    this._panel.webview.html = this._getHtml();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this._disposables,
    );
  }

  public dispose(): void {
    this._activeProc?.kill();
    AiAssistantPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) { d.dispose(); }
  }

  // ── Message handling ──────────────────────────────────────────────────────

  private async _handleMessage(message: { type: string; question?: string }): Promise<void> {
    if (message.type !== 'ask' || !message.question) { return; }

    const post = (data: object) => this._panel.webview.postMessage(data);
    const globalStoragePath = this._context.globalStorageUri.fsPath;

    // ── 1. Ensure venv + deps ────────────────────────────────────────────────
    let pythonBin: string;
    try {
      pythonBin = await ensureVenv(this._context.extensionPath, globalStoragePath);
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    }

    // ── 2. API key ───────────────────────────────────────────────────────────
    const apiKey = await this._getApiKey();
    if (!apiKey) {
      post({ type: 'error', message: 'No Anthropic API key configured.' });
      return;
    }

    // ── 3. Optional VCL context via temp file ────────────────────────────────
    let vclTempPath: string | undefined;
    const vclContent = this._getCurrentVclContent();
    if (vclContent) {
      vclTempPath = path.join(os.tmpdir(), `vinculum-${Date.now()}.vcl`);
      try { fs.writeFileSync(vclTempPath, vclContent, 'utf8'); } catch { vclTempPath = undefined; }
    }

    // ── 4. Build CLI args ────────────────────────────────────────────────────
    const config = vscode.workspace.getConfiguration('vinculum');
    const model = config.get<string>('model', 'claude-sonnet-4-6');

    const args = ['-m', 'vinculum_ai', '--model', model];
    if (vclTempPath) { args.push('--vcl', vclTempPath); }
    args.push(message.question);

    // ── 5. Spawn and stream ──────────────────────────────────────────────────
    const proc = cp.spawn(pythonBin, args, {
      env: {
        ...process.env,
        PYTHONPATH: path.join(this._context.extensionPath, 'python'),
        ANTHROPIC_API_KEY: apiKey,
      },
    });
    this._activeProc = proc;

    let accumulated = '';
    let leadingNewlines = true;

    proc.stdout.on('data', (chunk: Buffer) => {
      let text = chunk.toString('utf8');
      if (leadingNewlines) {
        text = text.replace(/^\n+/, '');  // CLI emits a blank line before the first token
        if (!text) { return; }
        leadingNewlines = false;
      }
      accumulated += text;
      post({ type: 'token', text });
    });

    let stderrText = '';
    proc.stderr.on('data', (chunk: Buffer) => { stderrText += chunk.toString('utf8'); });

    proc.on('close', async (code) => {
      this._activeProc = undefined;
      if (vclTempPath) { try { fs.unlinkSync(vclTempPath); } catch { /* ignore */ } }

      if (code === 0) {
        post({ type: 'rendered', html: await marked.parse(accumulated.trim()) });
        post({ type: 'done' });
      } else {
        const errorLine = stderrText.split('\n').find(l => l.startsWith('Error:'))
          ?? stderrText.trim()
          ?? `Process exited with code ${code}`;
        post({ type: 'error', message: errorLine });
      }
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      this._activeProc = undefined;
      if (vclTempPath) { try { fs.unlinkSync(vclTempPath); } catch { /* ignore */ } }
      post({ type: 'error', message: err.message });
    });
  }

  // ── API key ───────────────────────────────────────────────────────────────

  private async _getApiKey(): Promise<string | undefined> {
    const stored = await this._context.secrets.get('vinculum.apiKey');
    if (stored) { return stored; }

    if (process.env.ANTHROPIC_API_KEY) { return process.env.ANTHROPIC_API_KEY; }

    const entered = await vscode.window.showInputBox({
      title: 'Vinculum AI: Anthropic API Key',
      prompt: 'Enter your Anthropic API key (stored in VS Code secret storage)',
      password: true,
      placeHolder: 'sk-ant-...',
      ignoreFocusOut: true,
    });

    if (entered) {
      await this._context.secrets.store('vinculum.apiKey', entered);
      return entered;
    }

    return undefined;
  }

  // ── Active VCL file ───────────────────────────────────────────────────────

  private _getCurrentVclContent(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return undefined; }
    const doc = editor.document;
    if (doc.languageId !== 'vcl' && !doc.fileName.endsWith('.vcl')) { return undefined; }
    return doc.getText();
  }

  // ── Webview HTML ──────────────────────────────────────────────────────────

  private _getHtml(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Vinculum AI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex; flex-direction: column; height: 100vh; overflow: hidden;
    }
    #messages {
      flex: 1; overflow-y: auto; padding: 12px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .msg {
      max-width: 92%; padding: 8px 12px; border-radius: 6px;
      line-height: 1.5; white-space: pre-wrap; word-break: break-word;
    }
    .msg.user {
      align-self: flex-end;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .msg.assistant {
      align-self: flex-start;
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    .msg.error {
      align-self: flex-start;
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
    }
    .msg.assistant.thinking::after {
      content: '▋'; animation: blink 1s step-end infinite;
    }
    @keyframes blink { 50% { opacity: 0; } }
    .msg.assistant p { margin: 0 0 8px; }
    .msg.assistant p:last-child { margin-bottom: 0; }
    .msg.assistant pre {
      background: var(--vscode-textCodeBlock-background);
      border-radius: 4px; padding: 8px 12px; margin: 6px 0;
      overflow-x: auto; white-space: pre;
    }
    .msg.assistant code {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.95em;
    }
    .msg.assistant pre code { background: none; padding: 0; }
    .msg.assistant :not(pre) > code {
      background: var(--vscode-textCodeBlock-background);
      padding: 1px 4px; border-radius: 3px;
    }
    .msg.assistant ul, .msg.assistant ol { padding-left: 20px; margin: 4px 0 8px; }
    .msg.assistant li { margin: 2px 0; }
    .msg.assistant h1, .msg.assistant h2, .msg.assistant h3 {
      margin: 10px 0 4px; font-weight: 600;
    }
    .msg.assistant blockquote {
      border-left: 3px solid var(--vscode-panel-border);
      margin: 6px 0; padding: 2px 12px; opacity: 0.85;
    }
    #footer {
      display: flex; gap: 8px; padding: 8px 12px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    #input {
      flex: 1; resize: none; height: 60px; padding: 6px 8px;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border); border-radius: 4px;
    }
    #input:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
    #send {
      padding: 6px 14px; background: var(--vscode-button-background);
      color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer;
    }
    #send:hover { background: var(--vscode-button-hoverBackground); }
    #send:disabled { opacity: 0.5; cursor: default; }
  </style>
</head>
<body>
  <div id="messages">
    <div class="msg assistant">Hi! I'm your Vinculum VCL assistant. Ask me anything about VCL — block types, syntax, how to wire things together, or ask me to generate a config stub.</div>
  </div>
  <div id="footer">
    <textarea id="input" placeholder="Ask about VCL… (Enter to send, Shift+Enter for newline)"></textarea>
    <button id="send">Send</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const msgsEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendEl = document.getElementById('send');
    let currentDiv = null;
    let streaming = false;

    function addMsg(text, cls) {
      const d = document.createElement('div');
      d.className = 'msg ' + cls;
      d.textContent = text;
      msgsEl.appendChild(d);
      msgsEl.scrollTop = msgsEl.scrollHeight;
      return d;
    }

    function send() {
      const q = inputEl.value.trim();
      if (!q || streaming) { return; }
      addMsg(q, 'user');
      inputEl.value = '';
      streaming = true;
      sendEl.disabled = true;
      inputEl.disabled = true;
      currentDiv = addMsg('', 'assistant thinking');
      vscode.postMessage({ type: 'ask', question: q });
    }

    sendEl.addEventListener('click', send);
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });

    window.addEventListener('message', ({ data }) => {
      if (data.type === 'token' && currentDiv) {
        currentDiv.classList.remove('thinking');
        currentDiv.textContent += data.text;
        msgsEl.scrollTop = msgsEl.scrollHeight;
      } else if (data.type === 'rendered' && currentDiv) {
        currentDiv.innerHTML = data.html;
        msgsEl.scrollTop = msgsEl.scrollHeight;
      } else if (data.type === 'done') {
        streaming = false; sendEl.disabled = false;
        inputEl.disabled = false; currentDiv = null; inputEl.focus();
      } else if (data.type === 'error') {
        if (currentDiv) { currentDiv.remove(); currentDiv = null; }
        addMsg('Error: ' + data.message, 'error');
        streaming = false; sendEl.disabled = false;
        inputEl.disabled = false; inputEl.focus();
      }
    });

    inputEl.focus();
  </script>
</body>
</html>`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
