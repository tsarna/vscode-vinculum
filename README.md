# Vinculum VCL for VS Code

VS Code support for the [Vinculum](https://github.com/tsarna/vinculum) Configuration Language (`.vcl`) — an HCL-based language for describing event-driven integrations, automations, and pipelines.

## Features

- **Syntax highlighting** for all current Vinculum block types — `bus`, `subscription`, `trigger`, `condition`, `fsm`, `procedure`, `editor`, `server`, `client`, `function`, `jq`, `metric`, `wire_format`, and the supporting `assert` / `const` / `var` blocks.
- **Snippets** for every top-level block type, every supported client (`kafka`, `mqtt`, `rabbitmq`, `redis`, `sqs`/`sns`, `http`, `otlp`, `openai`, `vws`, ...), every server type, every trigger type, and every condition variant. Type a block keyword (`fsm`, `condition-timer`, `trigger-interval`, `client-rabbitmq`, ...) and press Tab.
- **Hover documentation** for VCL keywords.
- **Ask AI** — a chat panel that answers Vinculum questions using the official docs via retrieval-augmented generation (RAG). Works with Anthropic, OpenAI, Groq, and other model providers.

## Installation

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=tsarna.vscode-vinculum) (search for "Vinculum VCL"), or grab the latest `.vsix` from the [GitHub Releases](https://github.com/tsarna/vscode-vinculum/releases) page and run `code --install-extension <file>.vsix`.

`.vcl` files are recognized automatically. No additional configuration is needed for highlighting and snippets.

## AI Assistant

Open the Command Palette and run **Vinculum: Ask AI** to launch the chat panel.

### One-time setup

The AI assistant shells out to a bundled Python CLI (`vinculum-ai`) which uses RAG to retrieve only the relevant portions of the Vinculum documentation for each question — far cheaper than dumping the entire doc corpus into every prompt.

On first use the extension creates an isolated Python virtual environment under VS Code's global storage and installs the assistant's dependencies into it. This is a one-time step (typically under a minute) and works correctly on PEP 668 systems such as Homebrew Python on macOS.

### API key

The first time you run **Ask AI** you'll be prompted for an API key. The key is stored in VS Code's encrypted secret storage. Alternatively, set `ANTHROPIC_API_KEY` (or the equivalent for your chosen provider) in your shell environment.

### Choosing a model

The `vinculum.model` setting controls which model is used. Defaults to `claude-sonnet-4-6`. Any model supported by the [LiteLLM](https://docs.litellm.ai/) router can be used by name, e.g. `gpt-4o-mini`, `claude-haiku-4-5`, `llama-3.3-70b-versatile`.

### Refreshing the doc index

Vinculum docs update frequently. Run **Vinculum: Refresh AI Index** from the Command Palette to re-fetch the latest documentation and rebuild the local index.

## Commands

| Command | Description |
| --- | --- |
| `Vinculum: Ask AI` | Open the AI chat panel |
| `Vinculum: Refresh AI Index` | Re-fetch the latest Vinculum docs and rebuild the local RAG index |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `vinculum.model` | `claude-sonnet-4-6` | Model name passed to vinculum-ai |
| `vinculum.pythonPath` | `python3` | Path to the Python 3 interpreter used to create the AI environment |

## Snippet quick reference

Type the prefix and press Tab.

| Prefix | Produces |
| --- | --- |
| `bus`, `const`, `var`, `assert` | Bus declaration, constants block, variable, assertion |
| `subscription`, `subscription-transforms` | Bus subscription with optional transform pipeline |
| `trigger-cron` / `-interval` / `-at` / `-after` / `-watch` / `-file` / `-signals` / `-watchdog` / `-start` / `-shutdown` / `-once` | Triggers of each type |
| `condition-timer` / `-threshold` / `-counter` / `-hooks` | Condition variants and lifecycle-hooks form |
| `fsm` | Finite state machine with states, events, transitions |
| `procedure` | Procedure block with `spec` and `return` |
| `editor-line` | Line-based regex editor |
| `function`, `jq` | User-defined function / JQ function |
| `server-http` / `-mcp` / `-vws` / `-websocket` / `-metrics` | Server blocks |
| `handle`, `files`, `tool`, `resource`, `prompt` | HTTP & MCP sub-blocks |
| `client-aws` / `-http` / `-kafka` / `-llm` / `-mqtt` / `-mqtt-tls` / `-openai` / `-otlp` / `-rabbitmq` / `-redis` / `-redis-pubsub` / `-redis-kv` / `-redis-stream` / `-sns-sender` / `-sqs-sender` / `-sqs-receiver` / `-vws` | Client blocks for each supported integration |
| `metric-gauge` / `-counter` / `-histogram` | Prometheus metric types |

## Issues & contributions

Issues and pull requests are welcome on [GitHub](https://github.com/tsarna/vscode-vinculum).

## License

MIT — see [LICENSE](LICENSE).
