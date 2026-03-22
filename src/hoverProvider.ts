import * as vscode from 'vscode';

interface HoverEntry {
  signature: string;
  description: string;
}

const HOVERS: Map<string, HoverEntry> = new Map([
  ['assert', {
    signature: 'assert "name" {\n    condition = expression\n}',
    description: 'Checks that `condition` is true at startup; aborts with an error if not.\n\nUseful for validating required environment variables or config values.',
  }],
  ['bus', {
    signature: 'bus "name" {\n    queue_size = 1000  # optional\n}',
    description: 'Declares an event bus for publish/subscribe messaging.\n\n`bus.main` always exists implicitly. `queue_size` controls how many messages can be queued before dropping (default 1000).',
  }],
  ['client', {
    signature: 'client "type" "name" {\n    ...\n}',
    description: 'Defines a connection to an external service. Available in expressions as `client.<name>`.\n\n**Types:** `"openai"` — OpenAI-compatible LLM API · `"vws"` — Vinculum WebSocket client',
  }],
  ['const', {
    signature: 'const {\n    name = value\n    ...\n}',
    description: 'Defines named constants available in all expressions. Evaluated once at startup. Multiple `const` blocks are merged.',
  }],
  ['cron', {
    signature: 'cron "name" {\n    timezone = "UTC"  # optional\n\n    at "* * * * *" "rule" {\n        action = expression\n    }\n}',
    description: 'Defines a cron-style scheduler. Each `at` block specifies a schedule in standard cron format (5 fields) or a 6-field format where the first field is seconds.',
  }],
  ['function', {
    signature: 'function "name" {\n    params = [a, b]\n    result = expression\n}',
    description: 'Defines a user-callable function using the HCL userfunc extension.\n\n`params` takes variable names (not strings). The function is available by name in all expressions.',
  }],
  ['jq', {
    signature: 'jq "name" {\n    params = [param1]  # optional\n    query  = "jq expression"\n}',
    description: 'Defines a function backed by a [JQ](https://jqlang.org/) query.\n\nString inputs are parsed as JSON, the query runs, and the result is re-encoded. Non-string inputs are passed through as HCL values.',
  }],
  ['metric', {
    signature: 'metric "type" "name" {\n    help = "description"\n}',
    description: 'Declares a Prometheus/OpenMetrics metric. Available in expressions as `metric.<name>`.\n\n**Types:** `"gauge"` · `"counter"` · `"histogram"`',
  }],
  ['server', {
    signature: 'server "type" "name" {\n    listen = ":8080"\n    ...\n}',
    description: 'Defines a network server. Available in expressions as `server.<name>`.\n\n**Types:** `"http"` · `"websocket"` · `"vws"` · `"mcp"`',
  }],
  ['signals', {
    signature: 'signals {\n    SIGHUP  = expression\n    SIGUSR1 = expression\n}',
    description: 'Maps OS signals to action expressions.\n\n**Available signals:** `SIGHUP` · `SIGINFO` · `SIGUSR1` · `SIGUSR2`\n\nIn the action, `ctx.signal` is the signal name and `ctx.signal_num` is the OS-level number.',
  }],
  ['subscription', {
    signature: 'subscription "name" {\n    target = bus.main\n    topics = ["topic/#"]\n    action = expression\n}',
    description: 'Subscribes to messages from a bus or client.\n\nUse `action` to evaluate an expression per message, or `subscriber` to forward messages. Topic patterns use MQTT syntax: `+` matches one segment, `#` matches any trailing segments.',
  }],
  ['var', {
    signature: 'var "name" {\n    value = expression  # optional\n}',
    description: 'Declares a mutable runtime variable. Available in expressions as `var.<name>`.\n\nUse `get()`, `set()`, and `increment()` to read/write at runtime. Variables are goroutine-safe.',
  }],

  // Sub-block keywords
  ['at', {
    signature: 'at "* * * * *" "rule_name" {\n    action = expression\n}',
    description: 'A schedule rule inside a `cron` block. The first label is a cron expression (5 or 6 fields), the second is a name used in `ctx.at_name`.',
  }],
  ['handle', {
    signature: 'handle "METHOD /path" {\n    action = expression\n}',
    description: 'An HTTP route handler inside a `server "http"` block.\n\nUses Go 1.22 `http.ServeMux` pattern syntax. Use `{name}` for path parameters (read with `getpathvalue("name")`).',
  }],
  ['files', {
    signature: 'files "/url-prefix" {\n    directory = "./web"\n}',
    description: 'Serves a directory of static files inside a `server "http"` block.',
  }],
  ['tool', {
    signature: 'tool "name" {\n    description = "..."\n    action      = expression\n}',
    description: 'Exposes a callable tool to MCP clients inside a `server "mcp"` block.',
  }],
  ['resource', {
    signature: 'resource "scheme://path/{param}" {\n    name   = "Display Name"\n    action = expression\n}',
    description: 'Exposes a resource to MCP clients inside a `server "mcp"` block.\n\nCurly-brace placeholders in the URI are extracted as `ctx.<name>`.',
  }],
  ['prompt', {
    signature: 'prompt "name" {\n    description = "..."\n    action      = expression\n}',
    description: 'Exposes a prompt template to MCP clients inside a `server "mcp"` block.',
  }],

  // Built-in variable namespaces
  ['ctx', {
    signature: 'ctx',
    description: 'The current execution context, available inside `action` expressions.\n\nAttributes vary by context: `ctx.topic` and `ctx.msg` in subscriptions; `ctx.method`, `ctx.url` etc. in HTTP handlers; `ctx.signal` in signal handlers.',
  }],
  ['env', {
    signature: 'env.<NAME>',
    description: 'Access to environment variables. For example, `env.HOME` returns the value of the `HOME` environment variable.',
  }],
  ['http_status', {
    signature: 'http_status.<Name>',
    description: 'Named HTTP status code constants. For example, `http_status.OK` is `200`, `http_status.NotFound` is `404`.\n\n`http_status.by_code[200]` maps a code number back to its name.',
  }],
]);

export function registerHoverProvider(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider('vcl', {
      provideHover(document, position) {
        const range = document.getWordRangeAtPosition(position);
        if (!range) { return; }

        const word = document.getText(range);
        const entry = HOVERS.get(word);
        if (!entry) { return; }

        const md = new vscode.MarkdownString(undefined, true);
        md.appendCodeblock(entry.signature, 'hcl');
        md.appendMarkdown('\n' + entry.description);
        return new vscode.Hover(md, range);
      },
    }),
  );
}
