# Story to CYOA user guide

## Start locally

From the project folder run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/launch.ps1
```

The launcher uses Codex's bundled Node and pnpm when they are available; otherwise it expects Node.js 20+ and pnpm on `PATH`. It installs locked dependencies when needed, builds the app, starts a loopback-only service, waits for its health check, and opens the browser.

## Generate an adaptation

1. Enter your OpenRouter API key. The key stays in the local server process and is not included in generated files.
2. Paste source text or load a TXT/HTML AO3 download. For long works, start with one arc under 250,000 characters.
3. Add optional direction such as desired routes, relationships, endings, or content boundaries.
4. Keep `openrouter/auto` or enter a specific OpenRouter model ID.
5. Choose a target of 8–40 passages and select **Generate CYOA**.

The generator requests an existing-protagonist adaptation with visible stats, relationship state, meaningful divergence, controlled reconvergence, and multiple endings. It validates the branch graph and asks the model to repair broken links once before failing.

## Play and export

Play the result directly below the generator. The preview tracks visible stats and relationship labels. Download editable Twee source or a standalone playable HTML file. If Tweego is not installed, the app automatically uses its built-in standalone HTML compiler.

## Troubleshooting

- If generation says the key is not configured, save the key again after restarting the app; the default store is process-local.
- If a model cannot produce valid structured JSON, try another model or reduce the passage count.
- If a long source exceeds context limits, select a chapter or arc.
- The application listens only on `127.0.0.1` by default.
- Use only material you are permitted to import and adapt.
