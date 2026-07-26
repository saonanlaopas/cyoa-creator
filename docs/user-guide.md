# Story to CYOA user guide

## Start locally

Install Node.js 20+ and enable pnpm with `corepack enable`. From the project folder run `powershell -ExecutionPolicy Bypass -File scripts/launch.ps1`. The launcher installs locked dependencies when needed, starts a loopback-only service, waits for its health check, and opens the app. It warns when Tweego is missing; install it under `tools/tweego/` before exporting Twee.

## Create an adaptation

Choose **Create project**, import a text, Markdown, or downloaded AO3 file that you have the right to adapt, select the chapters, then review the cited story bible. Pick Economy, Balanced, or Quality. Use **Advanced** only when you need a per-operation model, generation controls, or a cost cap. Any non-zero estimated operation requires confirmation; keep the cap small while experimenting.

Approve the mechanics to enter the studio. The left pipeline selects artifacts, the center is the active workspace, and the right assistant proposes changes. The story map is an expandable workspace mode. Stale notices mean an upstream source changed; regenerate or explicitly compare versions before approving an artifact.

## Play, repair, and export

Use **Play preview** to follow passages, inspect visible state, restart, or backtrack. Send feedback from the current passage; it is attached to that passage and artifact version. In **Findings**, inspect citations, request a repair, then approve or reject its proposal. Export HTML for browser play or Twee when Tweego is installed.

## Keys, backups, and troubleshooting

Provider keys are write-only and are sent to the local service; never paste them into story text. Back up the project data directory before major rewrites and copy exports separately. If the app will not open, visit `/api/health`; if it fails, rerun the launcher and inspect the terminal error. If an export is unavailable, verify `tools/tweego/tweego.exe`. Use only material you are permitted to import and adapt.
