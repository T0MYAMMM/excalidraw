// Run with: node --test file-server/server.nodetest.mjs (named so vitest ignores it)
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHandler, emptyScene, validateName } from "./server.mjs";

let dataDir;
let server;
let base;

const scene = (n) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements: [{ id: n }],
    appState: {},
    files: {},
  });

const api = (path, init = {}) => fetch(`${base}/api/files${path}`, init);
const post = (body) =>
  api("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "excali-files-"));
  server = createServer(createHandler(dataDir));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  await rm(dataDir, { recursive: true, force: true });
});

test("validateName rejects unsafe names", () => {
  for (const bad of [
    "",
    "   ",
    "../x",
    "a/b",
    "a\\b",
    ".hidden",
    "a:b",
    "x".repeat(101),
  ]) {
    assert.throws(() => validateName(bad), bad);
  }
  assert.equal(validateName("  My plan  "), "My plan");
});

test("create, list, read, update", async () => {
  let res = await post({ name: "First" });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).name, "First");
  assert.equal(
    await readFile(join(dataDir, "First.excalidraw"), "utf8"),
    emptyScene(),
  );

  res = await api("/First", { method: "PUT", body: scene("a") });
  assert.equal(res.status, 200);

  res = await api("/First");
  assert.deepEqual((await res.json()).elements, [{ id: "a" }]);

  res = await api("");
  const list = await res.json();
  assert.deepEqual(
    list.map((f) => f.name),
    ["First"],
  );
});

test("list sorts newest first and picks up dropped-in files", async () => {
  await post({ name: "old" });
  await new Promise((r) => setTimeout(r, 20));
  await writeFile(join(dataDir, "dropped.excalidraw"), scene("d"));
  await writeFile(join(dataDir, "notes.txt"), "ignored");
  const names = (await (await api("")).json()).map((f) => f.name);
  assert.deepEqual(names, ["dropped", "old"]);
});

test("duplicate names conflict", async () => {
  await post({ name: "Same" });
  assert.equal((await post({ name: "Same" })).status, 409);
});

test("rejects content that is not a scene", async () => {
  assert.equal((await post({ name: "x", content: "{}" })).status, 400);
  await post({ name: "y" });
  assert.equal(
    (await api("/y", { method: "PUT", body: "not json" })).status,
    400,
  );
});

test("update of a missing drawing is 404, not a silent create", async () => {
  assert.equal(
    (await api("/ghost", { method: "PUT", body: scene("g") })).status,
    404,
  );
});

test("rename moves the file and refuses to overwrite", async () => {
  await post({ name: "a" });
  await post({ name: "b" });
  const patch = (from, to) =>
    api(`/${from}`, { method: "PATCH", body: JSON.stringify({ newName: to }) });
  assert.equal((await patch("a", "b")).status, 409);
  const res = await patch("a", "c d");
  assert.equal(res.status, 200);
  assert.equal((await api("/c%20d")).status, 200);
  assert.equal((await api("/a")).status, 404);
});

test("delete moves the drawing to .trash", async () => {
  await post({ name: "gone" });
  assert.equal((await api("/gone", { method: "DELETE" })).status, 204);
  assert.equal((await api("/gone")).status, 404);
  const trashed = await readdir(join(dataDir, ".trash"));
  assert.equal(trashed.length, 1);
  assert.match(trashed[0], /^gone\..+\.excalidraw$/);
});

test("path traversal in the URL is rejected", async () => {
  assert.equal((await api("/..%2Fsecret")).status, 400);
});
