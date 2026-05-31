# src — Chippy source code

The full codebase for chippy. Each subfolder is a self-contained build of the app:

- `local/` — the locally running tool: vanilla HTML/CSS/JS ES modules opened directly in
  Chrome/Edge against a local folder via the File System Access API. This is the primary target
  (see the [target architecture](../documentation/target-architecture.md)).

Additional builds (for example a container / SQLite variant) may be added here later as sibling
folders.
