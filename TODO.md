# vscode-vinculum — Backlog

## Publish to Marketplace
- Install `vsce`: `npm install -g @vscode/vsce`
- Add an icon (`icon.png`, 128×128) to `package.json`
- Run `vsce package` to produce a `.vsix` for local testing
- Run `vsce publish` to push to the VS Code Marketplace

## Hover Documentation
- Add a `vscode.HoverProvider` for the `vcl` language
- On hover over a block keyword (`subscription`, `cron`, `server`, etc.), show a
  brief description and the relevant doc section
- No LSP required — pure TypeScript `vscode.languages.registerHoverProvider`

## Context-aware Completions
- Add a `vscode.CompletionItemProvider` to replace dumb snippet triggers
- Know which attributes are valid inside each block type
  (e.g. inside `subscription { }` offer `target`, `topics`, `action`, `transforms`, ...)
- Rank completions by context (e.g. after `target =` offer `bus.` / `client.`)
- Can be layered on top of the existing grammar without an LSP

## Full Language Server (LSP)
- Move validation, hover, and completions into a separate language server process
- Add diagnostics: unknown block types, missing required attributes, type mismatches
- Go-to-definition across `.vcl` files in a workspace
- Significant undertaking — worth doing once the simpler features above are stable
