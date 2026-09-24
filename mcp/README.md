# Chippy MCP server

Lets an AI assistant (Claude Desktop, Claude Code, or any other MCP client) read and update a
Chippy notebook folder: list discussions, search entries, work through tasks, log progress,
capture ideas.

It runs the app's own `format.js`, `taxonomy.js`, `io.js` and `store.js` under Node, so every
write follows exactly the same rules as the browser app (datadefinition.md): header format,
default priorities, `→ STATE` action bullets, goal ids, tag and name indexes, linked entries.
Nothing about the data format is re-implemented here.

- `chippy-mcp.mjs` — entry point, stdio transport (newline-delimited JSON-RPC 2.0).
- `chippy-tools.mjs` — the tools and the JSON-RPC dispatcher.
- `node-fs-access.mjs` — a small File System Access API shim over `node:fs`, so `io.js` can
  work on a real folder instead of the browser's folder picker.
- `install.cmd` — double-click installer; runs `scripts/setup-mcp.mjs`.

No dependencies, no build step, no `npm install`. Requires Node.js 18.13 or later.

## Setup

### Install script (recommended)

Double-click `mcp\install.cmd`, or run it from a terminal:

```
mcp\install.cmd                                     (asks for the notebook folder)
mcp\install.cmd --folder "C:\path\to\Notebook" --read-only
mcp\install.cmd --claude-code                       (also register in Claude Code)
mcp\install.cmd --uninstall
```

The same script runs as `npm run mcp:setup -- <options>` or `node scripts/setup-mcp.mjs`.
It:

1. checks Node.js (18.13 or later);
2. finds the notebook folder — `--folder`, else `CHIPPY_NOTEBOOK`, else the folder of the
   discussion bound in `agent.md` (offered as the default at the prompt) — and refuses a
   folder Chippy has never opened;
3. smoke-tests the server against that folder (a real, read-only `initialize` +
   `list_discussions` round trip);
4. adds or updates the `chippy` entry in Claude Desktop's `claude_desktop_config.json`
   (`%APPDATA%\Claude\`, plus the Microsoft Store app's config when that is installed),
   keeping every other server and setting, with a timestamped `.bak-…` copy written first.
   An invalid config file is never overwritten. The entry uses absolute paths to `node` and
   the server, so it does not depend on Claude's `PATH` or working directory;
5. with `--claude-code`, runs `claude mcp add chippy --scope user …` as well.

Then quit Claude Desktop completely (tray icon → Quit) and start it again. `--dry-run` shows
the entry without writing anything; `--yes` skips the confirmation. Run it again after moving
the repo or the notebook — it updates the entry in place.

### Manual setup: Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json` (Settings → Developer → Edit Config) and
restart Claude Desktop completely:

```json
{
  "mcpServers": {
    "chippy": {
      "command": "node",
      "args": [
        "C:\\LocalDevelopment\\GitHub\\Chippy\\Chippy_Staging\\mcp\\chippy-mcp.mjs",
        "--folder",
        "C:\\Users\\<you>\\OneDrive\\<path>\\Notebook"
      ]
    }
  }
}
```

If it does not connect, check `%APPDATA%\Claude\logs\mcp-server-chippy.log`.

### Manual setup: Claude Code

```
claude mcp add chippy -- node C:\LocalDevelopment\GitHub\Chippy\Chippy_Staging\mcp\chippy-mcp.mjs --folder "C:\Users\<you>\OneDrive\<path>\Notebook"
```

Then `/mcp` in a session shows the server and its tools.

### Options

| Option | Effect |
|---|---|
| `--folder <path>` | The notebook folder (or set `CHIPPY_NOTEBOOK`). Must be a folder Chippy has opened before — the server never initializes an unknown folder. |
| `--read-only` | Only `list_discussions`, `read_discussion` and `search_entries` are offered. |
| `--include-sensitive` | Also expose entries tagged `sensitive` and discussions flagged sensitive. By default they are hidden from every tool, just as they are kept out of AI summaries in the app. |

### Testing by hand

```
npx @modelcontextprotocol/inspector node mcp/chippy-mcp.mjs --folder "C:\path\to\Notebook"
```

The Inspector lists the tools and lets you call them from the browser. Point it at a copy of your
notebook while experimenting with the write tools.

## Tools

Entries are addressed by `discussion` + `created_at` + `idx`, exactly as returned by
`read_discussion` and `search_entries`. `created_at` alone is not unique (legacy minute-precision
headers), so when two entries share it the server asks for `idx`.

| Tool | Writes | What it does |
|---|---|---|
| `list_discussions` | | Discussions with sidebar group, favorite flag and counts of entries and open tasks/ideas/goals. |
| `read_discussion` | | Preparation notes and entries: type, state, priority, due, free-form tags, text, dated actions, link info. |
| `search_entries` | | Across all discussions with Chippy's search syntax (`#tag`, `@[Full Name]`, free text), plus filters for type, open-only and state, sorted newest / oldest / by priority. |
| `add_entry` | ✓ | New comment, task, followup, goal or idea with optional priority, due date, tags and initial state (e.g. `HOLD` for a proposal the user should approve). |
| `set_state` | ✓ | Task: OPEN, WIP, CHK, HOLD, PRGT, DONE, OBSL. Goal: Open, Achieved, Canceled. Idea: Considered, Explored, Realized, Shelved. Logs `- YYYY-MM-DD : → STATE`. |
| `append_action` | ✓ | Adds `- YYYY-MM-DD : <text>` to the entry's action log. |
| `update_entry` | ✓ | Text, priority, due date, add/remove free-form tags. The action log is kept; on a later day an `Updated:` line is written. |
| `promote_idea` | ✓ | Task from an Explored/Promoted idea, goal from a Promoted idea, with the same cross-link bullets as the app's → Task… / → Goal…. |
| `create_discussion` | ✓ | New empty discussion (a taken name gets `_2`, `_3`, …). |

Writes to a linked reference are applied to its origin entry, like in the app. Reserved tags
(states, priorities, goal and link ids, `sensitive`, `muted:`) cannot be set through `tags` —
use `kind`, `priority` and `set_state`. The server never deletes, moves, renames or archives
anything.

## Working next to the app

The folder is the source of truth. Every tool call first re-reads the folder, so the server
always sees what the app (or OneDrive) last saved. The app, however, keeps what it has loaded in
memory: after the assistant has written something, press **Reload folder** (↻ next to +) in
Chippy before editing the same discussion there, otherwise the app's next save of that
discussion overwrites the assistant's change.

Like the app, the server migrates an older folder layout on first open (system files to
`*.sys.chippy.md`, `<stem>.md` to `<stem>.chippy.md`).

## Tests

`tests/local/unit/mcp-server.test.mjs` runs every tool against a temporary folder and checks the
exact bytes written, plus one end-to-end stdio exchange. `tests/local/unit/mcp-setup.test.mjs`
covers the install script against a temporary config file. Both are part of
`npm run test:local:unit`.
