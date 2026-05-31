# src/local — Local chippy app

The locally running chippy tool. Per the
[target architecture](../../documentation/target-architecture.md), the application is a set of
**flat ES module scripts at this folder root — no subfolders for application code**:

`main.js`, `format.js`, `io.js`, `store.js`, `ui.js`, `discussion.js`, `pages.js`, `dashboard.js`,
alongside `app.html`, `style.css`, and the vendored `dompurify.min.js`.

Build order and acceptance criteria are defined in the
[implementation plan](../../documentation/implementation-plan.md), starting at Step 1. This folder
is currently a scaffold — implementation lands here per the plan.
