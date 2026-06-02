# vscode-vinculum — Backlog

## Logo
- Replace the placeholder icon (V with overbar on indigo) with a proper Vinculum logo
- Needs to be 128×128 PNG; source SVG is in `icon.svg`
- Regenerate `icon.png` from `scripts/generate-icon.js` after updating the SVG
- Publish a new patch version once updated

## CI: Auto-publish to Marketplace on tag
- Workflow step is in place — store a Marketplace PAT as the `VSCE_PAT` GitHub Actions secret to activate it
- Optionally add an Open VSX step (`OVSX_PAT` secret + `npx ovsx publish`) to mirror to VSCodium/Cursor

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
