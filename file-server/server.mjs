/**
 * Minimal file storage API for the personal Excalidraw file manager.
 *
 * Every drawing is a plain `<name>.excalidraw` file in DATA_DIR, so the
 * folder stays readable and files dropped into it show up in the app.
 * Deleted drawings are moved to `DATA_DIR/.trash/`, never removed.
 *
 * Routes (all JSON unless noted):
 *   GET    /api/files                  -> [{ name, size, updatedAt }]
 *   POST   /api/files                  { name, content? } -> 201 { name, ... }
 *   GET    /api/files/:name            -> scene JSON (raw)
 *   PUT    /api/files/:name            scene JSON -> { name, size, updatedAt }
 *   PATCH  /api/files/:name            { newName } -> { name, ... }
 *   DELETE /api/files/:name            -> 204 (moved to .trash)
 *
 * No dependencies: only Node built-ins.
 */
import { createServer } from "node:http";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const EXTENSION = ".excalidraw";
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const MAX_NAME_LENGTH = 100;

/** Scene used when a new drawing is created without content. */
export const emptyScene = () =>
  JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: "excalidraw-file-manager",
      elements: [],
      appState: {},
      files: {},
    },
    null,
    2,
  );

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Returns the trimmed name if it is safe to use as a file name, else throws.
 * Rejects path separators, control characters, leading dots and
 * characters Windows can't store, so files stay portable.
 */
export const validateName = (raw) => {
  if (typeof raw !== "string") {
    throw new HttpError(400, "name must be a string");
  }
  const name = raw.trim();
  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, `name must be 1-${MAX_NAME_LENGTH} characters`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name) || name.startsWith(".")) {
    throw new HttpError(400, "name contains characters that aren't allowed");
  }
  return name;
};

/** Throws unless `text` parses as an Excalidraw scene. */
const validateScene = (text) => {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, "content is not valid JSON");
  }
  if (data?.type !== "excalidraw" || !Array.isArray(data.elements)) {
    throw new HttpError(400, "content is not an Excalidraw scene");
  }
};

const exists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

/** Writes via a temp file + rename so a crash never leaves half a drawing. */
const writeAtomic = async (path, text) => {
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, path);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "drawing is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const readJsonBody = async (req) => {
  try {
    return JSON.parse(await readBody(req));
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, "body is not valid JSON");
  }
};

const send = (res, status, body, headers = {}) => {
  const isText = typeof body === "string";
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(
    body === undefined ? undefined : isText ? body : JSON.stringify(body),
  );
};

/** Creates the request handler bound to one data directory. */
export const createHandler = (dataDir) => {
  const trashDir = join(dataDir, ".trash");
  const pathFor = (name) => join(dataDir, `${name}${EXTENSION}`);

  const info = async (name) => {
    const s = await stat(pathFor(name));
    return { name, size: s.size, updatedAt: s.mtime.toISOString() };
  };

  const requireFile = async (name) => {
    if (!(await exists(pathFor(name)))) {
      throw new HttpError(404, "drawing not found");
    }
  };

  const list = async () => {
    const entries = await readdir(dataDir, { withFileTypes: true });
    const names = entries
      .filter((e) => e.isFile() && e.name.endsWith(EXTENSION))
      .map((e) => e.name.slice(0, -EXTENSION.length))
      .filter((name) => !name.startsWith("."));
    const files = await Promise.all(names.map(info));
    return files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  };

  const create = async (req) => {
    const body = await readJsonBody(req);
    const name = validateName(body?.name);
    const content = body?.content ?? emptyScene();
    validateScene(content);
    if (await exists(pathFor(name))) {
      throw new HttpError(409, "a drawing with that name already exists");
    }
    await writeAtomic(pathFor(name), content);
    return info(name);
  };

  const update = async (req, name) => {
    await requireFile(name);
    const content = await readBody(req);
    validateScene(content);
    await writeAtomic(pathFor(name), content);
    return info(name);
  };

  const renameFile = async (req, name) => {
    await requireFile(name);
    const body = await readJsonBody(req);
    const newName = validateName(body?.newName);
    if (newName !== name && (await exists(pathFor(newName)))) {
      throw new HttpError(409, "a drawing with that name already exists");
    }
    await rename(pathFor(name), pathFor(newName));
    return info(newName);
  };

  const trash = async (name) => {
    await requireFile(name);
    await mkdir(trashDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await rename(pathFor(name), join(trashDir, `${name}.${stamp}${EXTENSION}`));
  };

  return async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const match = url.pathname.match(/^\/api\/files(?:\/([^/]+))?\/?$/);
      if (!match) {
        throw new HttpError(404, "not found");
      }
      const name = match[1] ? validateName(decodeURIComponent(match[1])) : null;

      if (!name && req.method === "GET") {
        return send(res, 200, await list());
      }
      if (!name && req.method === "POST") {
        return send(res, 201, await create(req));
      }
      if (name && req.method === "GET") {
        await requireFile(name);
        return send(res, 200, await readFile(pathFor(name), "utf8"));
      }
      if (name && req.method === "PUT") {
        return send(res, 200, await update(req, name));
      }
      if (name && req.method === "PATCH") {
        return send(res, 200, await renameFile(req, name));
      }
      if (name && req.method === "DELETE") {
        await trash(name);
        return send(res, 204);
      }
      throw new HttpError(405, "method not allowed");
    } catch (error) {
      if (error instanceof HttpError) {
        return send(res, error.status, { error: error.message });
      }
      console.error(error);
      return send(res, 500, { error: "internal error" });
    }
  };
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const dataDir = process.env.DATA_DIR || "/data";
  const port = Number(process.env.PORT || 8080);
  await mkdir(dataDir, { recursive: true });
  createServer(createHandler(dataDir)).listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`file-server: serving ${dataDir} on :${port}`);
  });
}
