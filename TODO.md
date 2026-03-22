# vscode-vinculum — Backlog

## Logo
- Replace the placeholder icon (V with overbar on indigo) with a proper Vinculum logo
- Needs to be 128×128 PNG; source SVG is in `icon.svg`
- Regenerate `icon.png` from `scripts/generate-icon.js` after updating the SVG
- Publish a new patch version once updated

## GitHub CI
- Add `.github/workflows/ci.yml`
- On push: `npm install`, `npm run build`, `npm run typecheck`
- On tag (e.g. `v*`): also run `vsce package` and attach the `.vsix` as a release asset
- Consider `vsce publish` on tag using a stored PAT secret

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
