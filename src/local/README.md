# src/local — Local chippy app

The locally running chippy tool. Per the
[target architecture](../../documentation/target-architecture.md), the application is a set of
**flat classic scripts at this folder root — no subfolders for application code**. Each script
attaches its API to a single global `Chippy` namespace (no `import`/`export`), and `app.html`
loads them with ordered `<script>` tags:

`format.js`, `io.js`, `store.js`, `ui.js`, `discussion.js`, `pages.js`, `dashboard.js`, then
`main.js`, alongside `app.html`, `style.css`, and the vendored `dompurify.min.js`.

Build order and acceptance criteria are defined in the
[implementation plan](../../documentation/implementation-plan.md), starting at Step 1. This folder
is currently a scaffold — implementation lands here per the plan.

## Running

Open `app.html` directly in Chrome or Edge — double-click it, or use **File → Open File**. The app
runs from a `file://` page with no server: the scripts are classic (not ES modules), so they load
under `file://`, and Chrome exposes the File System Access API there for the Open Folder feature.

(`serve.cmd` is still provided if you prefer to run it over `http://localhost:8000` — handy for
DevTools workflows — but it is no longer required.)
