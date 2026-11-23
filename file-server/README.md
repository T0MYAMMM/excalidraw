# file-server

A small Node HTTP server, using only Node built-ins, that stores each drawing as a plain `<name>.excalidraw` file in one folder. The browser's Files tab, the MCP server and the agent scripts all go through it. See [LOCAL-STACK.md](../LOCAL-STACK.md) for the whole stack.

| File | What it is |
| --- | --- |
| `server.mjs` | The API |
| `server.nodetest.mjs` | Tests (`node --test file-server/server.nodetest.mjs`) |
| `Dockerfile` | `node:22-alpine` image with `server.mjs` baked in, runs as the `node` user |
| `nginx.conf` | Config for the app container, not this one. The root `Dockerfile` copies it into the app image. It serves the app, sends `/api/` here and `/api/rembg/` to rembg |

## Running

In Docker it is the `file-server` service (container `excalidraw-files`). Compose mounts `${DRAWINGS_DIR:-~/drawings}` at `/data` and runs it as uid 1000. It is not published on a host port; nginx reaches it at `http://file-server:8080`.

| Variable   | Default |
| ---------- | ------- |
| `DATA_DIR` | `/data` |
| `PORT`     | `8080`  |

The server exits with an error unless `DATA_DIR/.drawings-root` exists. After a reboot Docker can start the container before WSL has mounted `~/drawings`; exiting makes Docker retry until the real folder is there, instead of saving into an empty stand-in. Create the marker once with `touch ~/drawings/.drawings-root`.

The code is baked into the image, so rebuild after a change: `docker compose up -d --build file-server`. For `nginx.conf`, rebuild the app: `docker compose up -d --build excalidraw`.

## API

Every response has `Cache-Control: no-store`. `GET /api/files/:name` returns the file content unchanged.

| Request | Success | Errors |
| --- | --- | --- |
| `GET /api/files` | 200 `[{ name, size, updatedAt }]`, newest first |  |
| `POST /api/files` `{ name, content? }` | 201 `{ name, size, updatedAt, version }`; without `content` it creates an empty scene | 400 bad name or content, 409 name taken |
| `GET /api/files/:name` | 200 scene JSON with `ETag: "<version>"`; 304 when `If-None-Match` matches | 404 |
| `PUT /api/files/:name` (body = scene JSON) | 200 `{ name, size, updatedAt, version }` | 400, 404, 412 `{ error, version }` when `If-Match` is stale |
| `PATCH /api/files/:name` `{ newName }` | 200 `{ name, size, updatedAt }` | 404, 409 new name taken |
| `DELETE /api/files/:name` | 204; the file moves to `.trash/<name>.<timestamp>.excalidraw` | 404 |

Errors look like `{ "error": "message" }`. Unknown paths get 404 and other methods 405.

- **Versions**: the first 20 hex characters of the SHA-256 of the file content. A `PUT` without `If-Match` overwrites unconditionally; the browser and the MCP server always send it.
- **Writes** run one at a time, so a version check and its write can't interleave. Each write goes to a temp file that is then renamed over the drawing.
- **Names**: 1 to 100 characters after trimming. No `\ / : * ? " < > |`, no control characters, and no leading `.`, so names stay valid on Windows. Files whose names start with `.` are not listed.
- **Content** must be JSON with `"type": "excalidraw"` and an `elements` array. Bodies over 50 MB get 413.

## Examples

```bash
curl -s http://localhost:3000/api/files

# read, keeping the version
curl -s -D - "http://localhost:3000/api/files/My%20drawing" -o scene.json | grep -i etag

# write only if nobody changed it since
curl -s -X PUT -H 'Content-Type: application/json' -H 'If-Match: "<version>"' \
  --data-binary @scene.json "http://localhost:3000/api/files/My%20drawing"
```
