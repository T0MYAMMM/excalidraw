# excalidraw-files MCP server

Lets an AI agent (Claude Code, Claude Desktop, …) read and edit the drawings
the Excalidraw file manager keeps in `~/drawings`. It goes through the same
`/api/files` API as the browser, so new drawings and edits show up in the
app's **Files** tab, and an open tab reloads within a few seconds.

## Tools

| Tool | What it does |
|---|---|
| `excalidraw_format_guide` | Element format, colours and layout tips (read first) |
| `list_drawings` | Names and last-edited times |
| `read_drawing` | A drawing's elements in compact form (labels folded into shapes) |
| `create_drawing` | New drawing, optionally with elements; fails if the name is taken |
| `add_elements` | Add shapes, arrows, text |
| `update_elements` | Change elements by id; moving a shape keeps its label and arrows attached |
| `delete_elements` | Remove elements (and their labels) |

There is deliberately no tool that deletes or renames whole drawings; do that
in the app, where deletes go to `~/drawings/.trash/`.

Elements use the compact "skeleton" format of the official
[excalidraw-mcp](https://github.com/excalidraw/excalidraw-mcp): shapes take a
`label`, and arrows connect shapes with `start: { id }` / `end: { id }` and are
routed automatically.

## Safe with a browser open

Every write names the file version it was based on (`If-Match`). If the file
changed in between, the server re-reads it and re-applies the edit (up to 3
attempts, then the tool returns the error), so the agent never overwrites what
you just drew. On the browser side, an open
drawing reloads when it changes on disk; if you were editing at that very
moment, your edits are kept as a `<name> (conflict …)` copy.

## Setup

Needs the Excalidraw containers running (`docker compose up -d` in the repo
root) and Node 20+.

```bash
cd mcp-server && npm install
claude mcp add excalidraw-files --scope user -- node "$PWD/index.mjs"   # Claude Code
agy mcp add excalidraw-files node "$PWD/index.mjs"                      # Antigravity (agy)
```

The `agent-sections/` scripts need the agy registration. Remove with
`claude mcp remove excalidraw-files --scope user` or
`agy mcp remove excalidraw-files`.

`EXCALIDRAW_URL` (default `http://localhost:3000`) points it at another
instance.

## Limits and gotchas

- Images, frames and freehand strokes can't be created.
- `read_drawing` returns every element. On a large drawing (a full
  certification note map) that is a lot of output; work from ids you already
  know instead.
- `add_elements` rejects an id that a live element uses, but accepts the id of
  a deleted one. Deleted elements stay in the file (`isDeleted: true`) until
  the browser saves it. When the drawing next loads, the browser gives the
  newer element a random id, and its label keeps pointing at the old one. Use
  fresh ids. Details are in [LOCAL-STACK.md](../LOCAL-STACK.md#troubleshooting).

## Using it from scripts

The `agent-sections/` scripts import these modules directly instead of going
through MCP:

- `client.mjs`: `createClient(baseUrl)` returns `list`, `read`, `create` and
  `modify`. `modify(name, edit)` reads the scene, runs `edit(scene)`, and
  writes with `If-Match`. On a 412 it re-reads and runs `edit` again (3
  attempts), so `edit` must work on a fresh scene each time.
- `elements.mjs`: pure functions `addElements`, `updateElements`,
  `deleteElements` and `describeElements` that convert between the compact
  format and full elements.

## Why a custom server

- The official excalidraw-mcp renders diagrams inside the chat and keeps only
  temporary checkpoints. It doesn't touch `~/drawings`, and its hosted endpoint
  sends diagram content to Excalidraw's server.
- The community `yctimlin/mcp_excalidraw` runs its own canvas, which defaults
  to port 3000, the same port as this stack. Set its `PORT` if you try it.

## Tests

```bash
node --test mcp-server/elements.nodetest.mjs mcp-server/server.nodetest.mjs
```

The second file runs an MCP client against this server and the real
file-server API on a temporary folder.
