// Run with: node --test mcp-server/server.nodetest.mjs
/* global globalThis */
// End to end: an MCP client talks to this server, which talks to the real
// file-server handler over HTTP, backed by a temp folder.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createHandler } from "../file-server/server.mjs";

import { createServer } from "./server.mjs";

let dataDir;
let http;
let baseUrl;
let client;

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  return { text: res.content[0].text, isError: !!res.isError };
};

const readFileJson = async (name) =>
  JSON.parse(await readFile(join(dataDir, `${name}.excalidraw`), "utf8"));

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "excali-mcp-"));
  http = createHttpServer(createHandler(dataDir));
  await new Promise((r) => http.listen(0, r));
  baseUrl = `http://127.0.0.1:${http.address().port}`;

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer({ baseUrl }).connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
});

afterEach(async () => {
  await client.close();
  await new Promise((r) => http.close(r));
  await rm(dataDir, { recursive: true, force: true });
});

test("lists the tools, none of which deletes or renames drawings", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "add_elements",
    "create_drawing",
    "delete_elements",
    "excalidraw_format_guide",
    "list_drawings",
    "read_drawing",
    "update_elements",
  ]);
});

test("create, read, add, update and delete through MCP", async () => {
  let res = await call("create_drawing", {
    name: "Flow",
    elements: [
      {
        type: "rectangle",
        id: "web",
        x: 0,
        y: 0,
        width: 180,
        height: 80,
        label: { text: "Web" },
      },
    ],
  });
  assert.equal(res.isError, false, res.text);

  // the file on disk is a valid scene the app can open
  const onDisk = await readFileJson("Flow");
  assert.equal(onDisk.type, "excalidraw");
  assert.equal(onDisk.elements.length, 2); // shape + bound label

  res = await call("add_elements", {
    name: "Flow",
    elements: [
      { type: "ellipse", id: "db", x: 400, y: 0, width: 160, height: 80 },
      { type: "arrow", id: "a1", start: { id: "web" }, end: { id: "db" } },
    ],
  });
  assert.equal(res.isError, false, res.text);

  res = await call("update_elements", {
    name: "Flow",
    updates: [{ id: "db", label: { text: "Postgres" } }],
  });
  assert.equal(res.isError, false, res.text);

  res = await call("read_drawing", { name: "Flow" });
  const { elements } = JSON.parse(res.text);
  assert.deepEqual(
    elements.map((e) => [e.id, e.label?.text ?? null]),
    [
      ["web", "Web"],
      ["db", "Postgres"],
      ["a1", null],
    ],
  );
  assert.deepEqual(elements[2].start, { id: "web" });

  res = await call("delete_elements", { name: "Flow", ids: ["a1"] });
  assert.equal(res.isError, false, res.text);
  res = await call("read_drawing", { name: "Flow" });
  assert.equal(JSON.parse(res.text).elements.length, 2);

  res = await call("list_drawings");
  assert.match(res.text, /"name": "Flow"/);
});

test("mistakes come back as readable tool errors", async () => {
  let res = await call("read_drawing", { name: "Missing" });
  assert.equal(res.isError, true);
  assert.match(res.text, /not found/);

  await call("create_drawing", { name: "Taken" });
  res = await call("create_drawing", { name: "Taken" });
  assert.equal(res.isError, true);
  assert.match(res.text, /already exists/);

  res = await call("add_elements", {
    name: "Taken",
    elements: [
      { type: "arrow", id: "x", start: { id: "nope" }, end: { id: "nope2" } },
    ],
  });
  assert.equal(res.isError, true);
  assert.match(res.text, /isn't a rectangle/);
});

test("an edit made meanwhile by someone else is not overwritten", async () => {
  await call("create_drawing", {
    name: "Shared",
    elements: [
      { type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 60 },
    ],
  });

  // simulate the browser saving between the MCP server's read and write:
  // the first PUT is refused (412), the server re-reads and re-applies
  let interfered = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (init?.method === "PUT" && !interfered) {
      interfered = true;
      const scene = await readFileJson("Shared");
      scene.elements[0].strokeColor = "#e03131"; // the "browser" edit
      await realFetch(url, {
        method: "PUT",
        body: JSON.stringify(scene),
      });
    }
    return realFetch(url, init);
  };
  try {
    const res = await call("add_elements", {
      name: "Shared",
      elements: [
        { type: "ellipse", id: "b", x: 200, y: 0, width: 100, height: 60 },
      ],
    });
    assert.equal(res.isError, false, res.text);
  } finally {
    globalThis.fetch = realFetch;
  }
  const scene = await readFileJson("Shared");
  assert.equal(scene.elements[0].strokeColor, "#e03131"); // browser edit kept
  assert.deepEqual(
    scene.elements.map((e) => e.id),
    ["a", "b"],
  ); // and the MCP edit applied on top
});
