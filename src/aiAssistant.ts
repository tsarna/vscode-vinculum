import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';

const GITHUB_REPO = 'tsarna/vinculum';
const GITHUB_BRANCH = 'main';
const DOC_DIR = 'doc';
const CACHE_FILE = 'docs-cache.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface DocsCache {
  timestamp: number;
  content: string;
}

interface GithubFile {
  name: string;
  download_url: string;
}

export class AiAssistantPanel {
  public static currentPanel: AiAssistantPanel | undefined;
  private static readonly viewType = 'vinculumAI';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _context: vscode.ExtensionContext;
  private readonly _disposables: vscode.Disposable[] = [];

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
    const cacheUri = vscode.Uri.joinPath(context.globalStorageUri, CACHE_FILE);
    try {
      await vscode.workspace.fs.delete(cacheUri);
    } catch {
      // File didn't exist — that's fine
    }
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
    AiAssistantPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) { d.dispose(); }
  }

  // ── Message handling ──────────────────────────────────────────────────────

  private async _handleMessage(message: { type: string; question?: string }): Promise<void> {
    if (message.type !== 'ask' || !message.question) { return; }

    const post = (data: object) => this._panel.webview.postMessage(data);

    try {
      const apiKey = await this._getApiKey();
      if (!apiKey) {
        post({ type: 'error', message: 'No Anthropic API key configured.' });
        return;
      }

      const [docs, vclContent] = await Promise.all([
        this._loadDocs(),
        Promise.resolve(this._getCurrentVclContent()),
      ]);

      const model = vscode.workspace.getConfiguration('vinculum').get<string>('model', 'claude-sonnet-4-6');
      const anthropic = new Anthropic({ apiKey });

      const stream = anthropic.messages.stream({
        model,
        max_tokens: 4096,
        system: buildSystemPrompt(docs, vclContent),
        messages: [{ role: 'user', content: message.question }],
      });

      stream.on('text', (text) => post({ type: 'token', text }));

      await stream.finalMessage();
      post({ type: 'done' });
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
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

  // ── Docs: GitHub fetch with 24h cache ─────────────────────────────────────

  private async _loadDocs(): Promise<string> {
    // Check cache
    const cacheUri = vscode.Uri.joinPath(this._context.globalStorageUri, CACHE_FILE);
    try {
      const raw = await vscode.workspace.fs.readFile(cacheUri);
      const cache: DocsCache = JSON.parse(new TextDecoder().decode(raw));
      if (Date.now() - cache.timestamp < CACHE_TTL_MS) {
        return cache.content;
      }
    } catch {
      // Cache miss or parse error — fetch fresh
    }

    // Fetch from GitHub
    const content = await fetchDocsFromGitHub();

    // Persist cache (create directory if needed)
    try {
      await vscode.workspace.fs.createDirectory(this._context.globalStorageUri);
      const cache: DocsCache = { timestamp: Date.now(), content };
      await vscode.workspace.fs.writeFile(
        cacheUri,
        new TextEncoder().encode(JSON.stringify(cache)),
      );
    } catch {
      // Cache write failure is non-fatal
    }

    return content;
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

async function fetchDocsFromGitHub(): Promise<string> {
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${DOC_DIR}?ref=${GITHUB_BRANCH}`;
  const listResp = await fetch(apiUrl, {
    headers: { 'User-Agent': 'vscode-vinculum', 'Accept': 'application/vnd.github.v3+json' },
  });

  if (!listResp.ok) {
    throw new Error(`GitHub API error ${listResp.status}: ${await listResp.text()}`);
  }

  const files: GithubFile[] = await listResp.json() as GithubFile[];
  const mdFiles = files
    .filter(f => f.name.endsWith('.md'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const parts: string[] = [];
  for (const file of mdFiles) {
    const content = await fetch(file.download_url).then(r => r.text());
    parts.push(`## ${file.name}\n\n${content}`);
  }

  return parts.join('\n\n---\n\n');
}

function buildSystemPrompt(docs: string, vclContent: string | undefined): string {
  let prompt = `You are an AI assistant specializing in Vinculum Configuration Language (VCL).
VCL is a domain-specific configuration language built on top of HCL (HashiCorp Configuration Language),
similar to how Terraform configuration files relate to HCL.

Here is the complete Vinculum documentation:
<docs>
${docs}
</docs>
`;

  if (vclContent) {
    prompt += `
The user currently has this VCL file open:
<current_file>
${vclContent}
</current_file>
`;
  }

  prompt += `
Answer questions about VCL, help debug configurations, and generate VCL code snippets.
Be concise and practical. When showing VCL code, use proper HCL formatting.`;

  return prompt;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
