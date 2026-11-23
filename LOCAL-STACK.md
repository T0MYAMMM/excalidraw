# Local stack (branch `file-manager`)

This branch adds a self-hosted setup on top of upstream Excalidraw:

- **File manager**: drawings are saved as `.excalidraw` files in `~/drawings`, with a Files tab to create, open and download them.
- **MCP server**: AI agents (Claude Code, agy) can list, read and edit those drawings.
- **Background removal**: right-click an image, then **Remove background**. It runs in a local container.
- **Agent tooling**: scripts in `agent-sections/` that have agents draw study-note sections into a drawing.

Everything else is upstream Excalidraw; `README.md` and `dev-docs/` still apply.

## Parts

| Part | Code | Runs as |
| --- | --- | --- |
| App (nginx + built app) | `Dockerfile`, `excalidraw-app/`, `packages/` | container `excalidraw` (compose service `excalidraw`), http://localhost:3000 |
| File server | `file-server/` ([README](file-server/README.md)) | container `excalidraw-files` (service `file-server`) |
| Background removal | `rembg` service in `docker-compose.yml` | container `excalidraw-rembg` (service `rembg`) |
| MCP server | `mcp-server/` ([README](mcp-server/README.md)) | stdio process started by Claude Code or agy |
| Agent tooling | `agent-sections/` ([README](agent-sections/README.md)) | Python and Node scripts you run by hand |

```
browser ──► :3000  nginx (excalidraw)
                   ├─ /             built app
                   ├─ /api/files    ─► file-server:8080 ─► ~/drawings/*.excalidraw
                   └─ /api/rembg/   ─► rembg:7000
MCP server, agent scripts ──► http://localhost:3000/api/files
```

Only port 3000 is published. The file server and rembg can only be reached through nginx (`file-server/nginx.conf`).

## Start, stop, rebuild

First time:

```bash
mkdir -p ~/drawings && touch ~/drawings/.drawings-root
docker compose up -d --build        # from the repo root
```

Then open http://localhost:3000. The file server won't start without `~/drawings/.drawings-root` (see [Reboot safety](#reboot-safety)).

| Task | Command (repo root) |
| --- | --- |
| Stop / start again | `docker compose stop` / `docker compose start` |
| Status | `docker compose ps` |
| Logs | `docker compose logs -f file-server` (or `excalidraw`, `rembg`) |
| Rebuild after changing `excalidraw-app/`, `packages/` or `file-server/nginx.conf` | `docker compose up -d --build excalidraw` |
| Rebuild after changing `file-server/server.mjs` | `docker compose up -d --build file-server` |
| Remove the containers | `docker compose down` (drawings stay in `~/drawings`; `down -v` also deletes the downloaded rembg models) |
| Use another drawings folder | `DRAWINGS_DIR=/path/to/folder docker compose up -d` (the folder needs `.drawings-root`; set the variable on every compose command that recreates containers) |

- All three services have `restart: unless-stopped`, so they come back after a reboot unless you stopped them.
- Code and `nginx.conf` are baked into the images, so a change does nothing until you rebuild.
- The Vite dev server (`yarn start`, port 3001) has no `/api` proxy. The Files tab and Remove background only work in the Docker build on port 3000.
- The API has no authentication. Compose publishes `3000:80` on all interfaces; change it to `127.0.0.1:3000:80` if the machine is reachable from other hosts.

## File manager

- **Files** tab in the right sidebar (also Main menu → Files): New drawing, open, rename, duplicate, download `.excalidraw`, delete. Deleting moves the file to `~/drawings/.trash/`.
- When the canvas isn't a file yet, the tab offers **Save as new drawing**. With no drawing open the canvas works like stock Excalidraw (kept only in the browser).
- The open drawing is saved 800 ms after you stop editing, and also when the tab loses focus. Closing the page with unsaved changes saves them and asks you to confirm.
- The status under the name reads `Saving…`, `Saved` or `Not saved: server unreachable`.
- A reload reopens the last drawing (its name is kept in localStorage as `excalidraw-file-manager-current`). Other tabs follow through the app's tab sync.
- The list refreshes every 5 s and when the window gets focus, so drawings created by agents or copied into `~/drawings` show up.
- Images are embedded in the drawing file. A drawing can be up to 50 MB (nginx and the file server both enforce this).

Code: `excalidraw-app/file-manager/` (`api.ts` client, `session.ts` open drawing and autosave, `FilesPanel.tsx` the tab, `naming.ts`). Hooks into upstream: `excalidraw-app/App.tsx` (`onInitialize`, `onChange`, tab sync, blur, `beforeunload`), `components/AppSidebar.tsx`, `components/AppMainMenu.tsx`.

### Overwrite guard

The browser and agents can edit the same drawing without overwriting each other:

1. Every read returns the file's version (a content hash, sent as `ETag`). Every write sends the version it started from (`If-Match`). If the file changed in between, the server refuses the write with 412.
2. The open tab checks the file every 2 s (while visible and nothing is waiting to save) and reloads it when it changed on disk. The viewport is kept; undo history is cleared.
3. If you had unsaved edits when that happened, they are saved as `<name> (conflict YYYY-MM-DD HH.MM)`, the disk version is loaded, and a toast names the copy.
4. If the file was deleted or renamed outside the app, the tab stops autosaving to it.

The MCP server handles a 412 by re-reading the file and applying its edit again (up to 3 attempts).

## File API

Served by `file-server/server.mjs`, reached at `http://localhost:3000/api/files`. Details (names, errors, curl examples) in [file-server/README.md](file-server/README.md).

| Request | Result |
| --- | --- |
| `GET /api/files` | `[{ name, size, updatedAt }]`, newest first |
| `POST /api/files` `{ name, content? }` | 201; 409 if the name is taken |
| `GET /api/files/:name` | the scene JSON, `ETag: "<version>"`; 304 with a matching `If-None-Match` |
| `PUT /api/files/:name` (scene JSON) | `{ name, size, updatedAt, version }`; 412 `{ error, version }` on a stale `If-Match` |
| `PATCH /api/files/:name` `{ newName }` | renamed; 409 if the new name is taken |
| `DELETE /api/files/:name` | 204, file moved to `.trash/` |

## MCP server

`mcp-server/` is an MCP server named `excalidraw-files` that works through the same API, so agent edits appear in the Files tab and in an open tab within seconds.

- Tools: `excalidraw_format_guide`, `list_drawings`, `read_drawing`, `create_drawing`, `add_elements`, `update_elements`, `delete_elements`. There is no tool to delete or rename a whole drawing; do that in the app.
- Agents write compact skeletons (shapes with a `label`, arrows with `start`/`end`); `elements.mjs` turns them into full Excalidraw elements and routes arrows edge to edge.
- Needs the containers running. `EXCALIDRAW_URL` defaults to `http://localhost:3000`.

Register it once (after `npm install` in `mcp-server/`):

```bash
cd mcp-server
claude mcp add excalidraw-files --scope user -- node "$PWD/index.mjs"   # Claude Code
agy mcp add excalidraw-files node "$PWD/index.mjs"                      # Antigravity (agy)
```

Remove with `claude mcp remove excalidraw-files --scope user` or `agy mcp remove excalidraw-files`.

## Background removal

- Select one image, right-click, **Remove background** (just below Flip vertical). Ctrl+Z brings the original back. The result is a PNG embedded in the drawing.
- Runs in `excalidraw-rembg` (`danielgatis/rembg:2.0.86`, CPU only) behind nginx at `/api/rembg/`. The app posts to `/api/rembg/api/remove`.
- Model: `isnet-general-use`, set as `REMBG_MODEL` in `excalidraw-app/background-removal.ts`. It takes about 1 to 5 s per image and stays under 2 GB of RAM. The first run downloads the model into the `rembg-models` volume, which takes a minute or two.
- The container is capped at `mem_limit: 3g`. `birefnet-general-lite` gave cleaner edges but used 7 to 10 GB and crashed under WSL, so don't switch to it without raising the limit.
- The app gives up after 5 minutes; nginx waits up to 300 s for rembg.
- Editor side: the `actionRemoveImageBackground` action (`packages/excalidraw/actions/`) and the `onRemoveImageBackground(image: Blob) => Promise<Blob>` prop. The menu item appears only when the host passes the prop and exactly one loaded image is selected.

## Reboot safety

After a restart, Docker can start the containers before WSL has mounted the repo and `~/drawings`. Bind mounts then come up empty. Before this was fixed, the `excalidraw` container exited (code 127) and stayed down, and the Files tab showed "Can't reach the file server". The file server could also have saved drawings into an empty stand-in folder.

Now:

- `file-server/nginx.conf` is copied into the app image (root `Dockerfile`; `.dockerignore` lets it through).
- `file-server/server.mjs` is baked into its own small image (`file-server/Dockerfile`).
- Only the drawings folder is mounted, and the file server exits unless `/data/.drawings-root` exists, so Docker keeps restarting it until the real folder is there.

## Agent tooling

`agent-sections/` has agents (Antigravity `agy`) draw into drawings through the `excalidraw-files` MCP server, checks the results, and merges them. It is used for certification note maps: one drawing per exam, laid out in a six-colour hierarchy.

- [agent-sections/README.md](agent-sections/README.md): workflows (service sections, block-based materials), the scripts, and the model rule.
- [agent-sections/HIERARCHY.md](agent-sections/HIERARCHY.md): colour levels, layout and working rules. It is prepended to every agent prompt; read it before editing a note-map drawing.
- Model rule, applied by the scripts: `claude-opus-5-5-medium`, then `gemini-4-neon-medium` when Opus is out of quota, then wait for the earliest reset. Never Gemini Argon.
- Keep working files in the repo, not in `/tmp` or a scratchpad folder. A reboot has wiped one before.

## Troubleshooting

**Files tab says "Can't reach the file server" (or the status says "Not saved: server unreachable").**

1. `docker compose ps`: is `excalidraw-files` up, or restarting?
2. `docker compose logs file-server`. `/data/.drawings-root not found; drawings folder not mounted yet` means the folder isn't mounted yet, or the marker is missing. Wait, or run `touch ~/drawings/.drawings-root`.
3. If containers are `Exited` after a reboot, run `docker compose up -d`. If they were built before the reboot fix, use `docker compose up -d --build`.
4. Running `yarn start` on port 3001? It has no `/api` proxy; use port 3000.

**A drawing named `<name> (conflict …)` appeared.** The file changed on disk (an agent, a script or another tab) while you had unsaved edits. The original holds the disk version, and the copy holds your edits. Move what you need across, then delete the copy (it goes to `.trash/`).

**The open drawing reloaded by itself.** Something else wrote the file. Your viewport is kept, but undo history starts over.

**Element ids changed, or a box lost its label after the browser saved.** When a scene loads, Excalidraw's `restoreElements` (`packages/excalidraw/data/restore.ts`) gives any element whose id was already used earlier in the file a new random id. It doesn't update references to it, so a label's `containerId` can still point at the old id while the box's `boundElements` has the label. Deleted elements count: they stay in the file (`isDeleted: true`) until the browser next saves. The MCP server's `addElements` only rejects ids of live elements, so a script that deletes an element and adds a new one with the same id hits this. `agent-sections/aws-dea/link_services.mjs` does this with its `svc-chip-*` ids. Rules for scripts:

- Use fresh ids. Don't reuse the id of an element you just deleted.
- Find elements by what they are (type, colour, size, text, link), not by an id you stored earlier.
- Match a label to its box both ways: the box's `boundElements` and the text's `containerId`.

**Remove background fails.** "The background removal service isn't running" means nginx got a 502 or 504: run `docker compose up -d rembg` and check `docker compose logs rembg`. The first run is slow because the model is downloading. "Took too long" means the 5-minute limit was hit, usually on a very large image.

**An MCP tool returns "can't reach the Excalidraw file server".** Start the containers, or set `EXCALIDRAW_URL` if the app runs elsewhere.

**A file copied into `~/drawings` doesn't show up.** It needs the `.excalidraw` extension, a name that doesn't start with `.`, and no `\ / : * ? " < > |`. To open it must be JSON with `"type": "excalidraw"` and an `elements` array.

**A save fails with 413.** The drawing is over 50 MB, usually because of embedded images.

## Backups

- Built in: deletes go to `~/drawings/.trash/<name>.<timestamp>.excalidraw` (move a file back to restore it), conflicting edits become `(conflict …)` copies, and the file server writes through a temp file and a rename, so a crash never leaves half a drawing.
- Before a change that moves or rewrites many elements (a merge, a restructure, a batch of materials), copy the drawing out of `~/drawings` as `<drawing>_<YYYYMMDD>-<what>.excalidraw`, for example `..._20261122-before-restructure.excalidraw`. `agent-sections/HIERARCHY.md` names the folder used for these.
- Most scripts take `--dry-run`, and some write the result to a file you can open first.
- `~/drawings` is outside the repo. Nothing here backs it up.

## Tests

```bash
node --test file-server/server.nodetest.mjs
node --test mcp-server/elements.nodetest.mjs mcp-server/server.nodetest.mjs
npx vitest run excalidraw-app/file-manager excalidraw-app/background-removal.test.ts \
  packages/excalidraw/tests/removeImageBackground.test.tsx
```

None of these needs the containers. The context-menu snapshot (`packages/excalidraw/tests/__snapshots__/contextmenu.test.tsx.snap`) includes the new menu item.

## Upstream files this branch changes

Look here first when merging upstream:

- `Dockerfile` (copies `file-server/nginx.conf`), `.dockerignore` (lets that file through), `docker-compose.yml` (three services, drawings mount, rembg volume).
- `excalidraw-app/App.tsx`, `excalidraw-app/components/AppSidebar.tsx`, `excalidraw-app/components/AppMainMenu.tsx` (file manager hooks, Remove background callback).
- `excalidraw-app/vite.config.mts`: PWA precache limit raised from 2.3 MB to 3 MB.
- `packages/excalidraw/`: `actions/index.ts`, `actions/types.ts`, `components/App.tsx` (context menu), `index.tsx` and `types.ts` (`onRemoveImageBackground` prop), `locales/en.json` (`labels.removeImageBackground`).
