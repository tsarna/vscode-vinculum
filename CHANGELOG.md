# Changelog

## 0.3.0 — 2026-06-01

Catch-up release for Vinculum v0.33–v0.36 language additions.

### Syntax highlighting

- Recognize five new top-level block types: `condition`, `editor`, `fsm`, `procedure`, `wire_format`.
- Recognize the modern `trigger "<type>" "<name>"` block form. The legacy bare `cron` keyword is still highlighted for back-compat.
- Highlight procedure control-flow keywords inside `procedure` blocks: `if`, `elif`, `else`, `while`, `for`, `switch`, `case`, `return`, `in`.
- New built-in variable namespaces: `condition.*`, `fsm.*`, `sys.*`, `trigger.*`, `wire_format.*`.
- New sub-block keywords: `after`, `auth`, `before`, `event`, `match`, `params`, `reconnect`, `receiver`, `sasl`, `sender`, `spec`, `state`, `storage`, `tls`, `transition`, `will`.
- Recognize `required` as a constant (used in procedure parameter specs).

### Snippets

- New top-level block scaffolds: `fsm`, `procedure`, `editor-line`, `wire_format`; `condition-timer`, `condition-threshold`, `condition-counter`, `condition-hooks`.
- New trigger family — `trigger-cron` (replaces the old bare `cron` snippet), `trigger-interval`, `trigger-at`, `trigger-after`, `trigger-watch`, `trigger-file`, `trigger-once`, `trigger-start`, `trigger-shutdown`, `trigger-signals`, `trigger-watchdog`.
- Expanded client snippets — previously only `openai` and `vws`; now also `aws`, `http`, `kafka`, `llm`, `mqtt` (+ TLS variant), `otlp`, `rabbitmq`, `redis` (+ `pubsub`/`kv`/`stream` variants), `sns-sender`, `sqs-sender`, `sqs-receiver`.
- New sub-block helpers: `state`, `event`, `transition`, `match`, `spec`, `sender`, `receiver`.
- New `server-metrics` snippet.
- Removed the standalone `signals` snippet (superseded by `trigger-signals`).

## 0.2.0 — 2026-03-22

### AI assistant backend rewrite

- Replaced the direct Anthropic SDK calls (which sent the entire doc corpus on every query) with a subprocess call to a bundled `vinculum-ai` Python CLI that uses RAG to retrieve only relevant doc chunks — roughly 8× fewer tokens per query.
- The extension now manages its own Python venv under `globalStorageUri`, created on first use. Works on macOS/Homebrew (PEP 668) without manual setup.
- Bundled `python/` directory ships in the VSIX; no separate `pip install` required.
- Added `vinculum.pythonPath` setting to choose the Python used to seed the venv (default: `python3`).
- Renamed the `vinculum.clearDocCache` command to "Refresh AI Index".
- Dropped the `@anthropic-ai/sdk` dependency.

### CI

- Added GitHub Actions workflow for builds and tag-driven releases.

## 0.1.1 — 2026-03-22

- Added hover documentation for VCL keywords.
- Added markdown rendering to the AI chat panel.
- Added extension icon (V with overbar on indigo).

## 0.1.0 — 2026-03-22

Initial release.

- Phase 1: VCL syntax highlighting and snippets.
- Phase 2: AI assistance command backed by the Anthropic API.
