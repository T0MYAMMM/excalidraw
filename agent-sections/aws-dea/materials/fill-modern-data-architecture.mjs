/* eslint-disable no-console -- one-off fill script, reports to stdout */
// Fills the remaining "- Template" slots of material 3 (Modern Data
// Architectures on AWS) from cert-academy lesson dea-modern-data-architecture,
// in Thomas's style. His own content (title, Core Concepts cards) is kept.
// Usage: node fill-modern-data-architecture.mjs [--dry-run]
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const M = resolve(import.meta.dirname, "../../../mcp-server");
const { createClient } = await import(join(M, "client.mjs"));
const { addElements } = await import(join(M, "elements.mjs"));

const TARGET = "aws-data-engineer-associate";
const dryRun = process.argv.includes("--dry-run");
const newId = () => randomBytes(10).toString("base64url");

const fill = (scene) => {
  const live = scene.elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const mats = live
    .filter(
      (e) =>
        e.type === "rectangle" &&
        e.backgroundColor.toLowerCase() === "#fff4e6" &&
        e.width > 1000 &&
        !e.id.startsWith("legend-"),
    )
    .sort((a, b) => a.y - b.y);
  const box = mats[2];
  const g = box.groupIds.at(-1);
  const inMat = live.filter((e) => (e.groupIds ?? []).includes(g));
  const pick = (prefix) => {
    const e = inMat.find((x) => x.id.startsWith(prefix));
    if (!e) {
      throw new Error(`element ${prefix} not found in material 3`);
    }
    return e;
  };
  const labelOf = (e) =>
    (e.boundElements ?? [])
      .map((b) => byId.get(b.id))
      .find((t) => t?.type === "text");
  const touch = (e) => {
    e.version = (e.version ?? 1) + 1;
    e.versionNonce = Math.floor(Math.random() * 2 ** 31);
    e.updated = Date.now();
  };
  const setText = (e, text, fontSize) => {
    e.text = text;
    e.originalText = text;
    if (fontSize) {
      e.fontSize = fontSize;
    }
    const lines = text.split("\n");
    const perChar = e.fontFamily === 5 ? 0.62 : 0.55; // Excalifont is wider than Nunito
    e.width = Math.max(...lines.map((l) => l.length)) * e.fontSize * perChar;
    e.height = lines.length * e.fontSize * 1.25;
    touch(e);
  };
  const setLabel = (shape, text) => {
    const t = labelOf(shape);
    setText(t, text);
    t.x = shape.x + (shape.width - t.width) / 2;
    t.y = shape.y + (shape.height - t.height) / 2;
  };
  const remove = (e) => {
    for (const x of [e, labelOf(e)].filter(Boolean)) {
      x.isDeleted = true;
      touch(x);
    }
  };
  if (!inMat.some((e) => e.type === "text" && e.text.trim() === "- Template")) {
    throw new Error("material 3 has no template slots left");
  }

  const X = (dx) => box.x + dx;
  const Y = (dy) => box.y + dy;
  const added = [];
  // add elements in the material's group (plus an inner group per block)
  const add = (inputs, { family, inner } = {}) => {
    const before = scene.elements.length;
    addElements(scene.elements, inputs);
    const fresh = scene.elements.slice(before);
    const innerId = inner === undefined ? newId() : inner;
    for (const e of fresh) {
      e.groupIds = innerId ? [innerId, g] : [g];
      if (e.type === "text" && family && !e.containerId) {
        e.fontFamily = family;
      }
    }
    added.push(...fresh);
    return fresh;
  };

  // 1. Core Concepts: Data Mesh, under Lakehouse (same pattern as his cards)
  add(
    [
      {
        type: "rectangle",
        id: newId(),
        x: X(64),
        y: Y(492),
        width: 112,
        height: 35,
        backgroundColor: "#1971c2",
        strokeColor: "#ffffff",
        strokeWidth: 1,
        roughness: 0,
        label: { text: "Data Mesh", fontSize: 9.86, strokeColor: "#ffffff" },
      },
      {
        type: "text",
        id: newId(),
        x: X(194),
        y: Y(494),
        text: "domain teams own and publish their data as data\nproducts; a central team runs the platform and global\ngovernance; consumers subscribe through a catalog.",
        fontSize: 11.33,
      },
    ],
    { family: 6 },
  );
  add(
    [
      {
        type: "text",
        id: newId(),
        x: X(72),
        y: Y(532),
        text: "data products",
        fontSize: 11.33,
      },
    ],
    { inner: null },
  );
  add(
    [
      {
        type: "text",
        id: newId(),
        x: X(194),
        y: Y(548),
        text: "Amazon SageMaker Catalog + AWS Lake Formation",
        fontSize: 11.33,
        strokeColor: "#e03131",
      },
    ],
    { family: 6, inner: null },
  );

  // 2. Middle top: Data Lake Zones (replaces the Stateful/Stateless placeholders)
  setText(pick("t5oEyuAa"), "- Data Lake Zones");
  for (const p of ["9lCE8prA", "0R8awaaN", "BmrOqiMd", "IIxGAG1G"]) {
    remove(pick(p));
  }
  const zone = (id, dy, text, fill) => ({
    type: "rectangle",
    id,
    x: X(601),
    y: Y(dy),
    width: 94,
    height: 33,
    backgroundColor: fill,
    strokeWidth: 1,
    roughness: 0,
    label: { text, fontSize: 9.86 },
  });
  const zones = [
    [
      118,
      "Raw / Bronze",
      "#ffd8a8",
      "immutable copies of source data in the original\nformat (landing zone); keep them so you can replay",
    ],
    [
      196,
      "Cleansed / Silver",
      "#e9ecef",
      "deduplicated, typed and validated; converted to\nParquet / Iceberg",
    ],
    [
      274,
      "Curated / Gold",
      "#fff3bf",
      "business-level aggregates, conformed dimensions\nand data products for consumers",
    ],
  ];
  const zoneIds = zones.map(() => newId());
  add(
    [
      ...zones.map(([dy, label, fill], i) => zone(zoneIds[i], dy, label, fill)),
      {
        type: "arrow",
        id: newId(),
        start: { id: zoneIds[0] },
        end: { id: zoneIds[1] },
        strokeWidth: 1,
        roughness: 1,
      },
      {
        type: "arrow",
        id: newId(),
        start: { id: zoneIds[1] },
        end: { id: zoneIds[2] },
        strokeWidth: 1,
        roughness: 1,
      },
      ...zones.map(([dy, , , text]) => ({
        type: "text",
        id: newId(),
        x: X(708),
        y: Y(dy + 2),
        text,
        fontSize: 9.3,
      })),
    ],
    { family: 6 },
  );

  // 3. Middle: architecture pattern (data mesh flow)
  setText(pick("hSZAAWk_"), "- Architecture Pattern: data mesh");
  const flow = [
    [604, 86, "Producers\n(S3 + Glue /\nRedshift)"],
    [712, 72, "SageMaker\nCatalog"],
    [806, 72, "Lake\nFormation"],
    [900, 100, "Consumers (Athena /\nRedshift / QuickSight)"],
  ];
  const flowIds = flow.map(() => newId());
  add(
    [
      ...flow.map(([dx, w, text], i) => ({
        type: "rectangle",
        id: flowIds[i],
        x: X(dx),
        y: Y(404),
        width: w,
        height: 40,
        backgroundColor: "#e6fcf5",
        strokeWidth: 1,
        roughness: 0,
        label: { text, fontSize: 7.5 },
      })),
      ...[0, 1, 2].map((i) => ({
        type: "arrow",
        id: newId(),
        start: { id: flowIds[i] },
        end: { id: flowIds[i + 1] },
        strokeWidth: 1,
        roughness: 1,
      })),
      {
        type: "text",
        id: newId(),
        x: X(604),
        y: Y(452),
        text: "publish → search & subscribe → approved grant → cross-account share (AWS RAM).\nFinance's Redshift can also share live with a datashare, no copies.",
        fontSize: 7.5,
      },
    ],
    { family: 6 },
  );

  // 4. Middle bottom: exam tips (replaces the lorem ipsum)
  setText(pick("LfcyNqgR"), "- Exam Tips & Traps");
  const tips = pick("3zyYXNOF");
  setText(
    tips,
    '1. "No copies / no data movement" = data sharing, Spectrum, federated query or LF grants, not exports.\n2. Upserts or GDPR deletes on S3 data = Iceberg (or Hudi/Delta), not rewriting partitions by hand.\n3. Lake Formation stores no data: it governs access to S3 data and catalog resources.\n4. Don\'t put raw, unstructured or rarely queried data in the warehouse: costly and inflexible.',
    8.5,
  );
  tips.fontFamily = 6;

  // 5. Right top: data sharing patterns (reuses the 4-row table, adds a 5th row)
  setText(pick("49keupVY"), "- Data Sharing Patterns");
  const rows = [
    [
      "bewNeqid",
      "uPEzA5nh",
      "05lWSkOy",
      "Centralized lake",
      "No",
      "one account holds all data;\nLake Formation grants to consumers",
    ],
    [
      "pAM3FHEr",
      "nri8Wry6",
      "vxbouoA-",
      "Hub-and-spoke / mesh",
      "No",
      "producers own data, central catalog;\ncross-account LF grants via AWS RAM",
    ],
    [
      "NFVUbvG-",
      "-LtL200X",
      "TqsyQQsV",
      "Warehouse to warehouse",
      "No",
      "Redshift data sharing (same/cross-\naccount, cross-Region); live, read-only",
    ],
    [
      "ssiujx_w",
      "NgT5ggL3",
      "-IfS32e5",
      "External / third-party",
      "±",
      "AWS Data Exchange (files, APIs,\nRedshift datashares, S3 access)",
    ],
  ];
  for (const [card, circle, text, name, copy, mech] of rows) {
    setLabel(pick(card), name);
    setLabel(pick(circle), copy);
    const t = pick(text);
    t.fontFamily = 6;
    setText(t, mech, 7);
  }
  const lastCard = pick("ssiujx_w");
  const rowGroups = lastCard.groupIds.slice(1, -1); // table group(s) between row and material
  const c5 = newId();
  const e5 = newId();
  add(
    [
      {
        type: "rectangle",
        id: c5,
        x: X(1059),
        y: Y(309),
        width: 182,
        height: 31,
        backgroundColor: "#e6fcf5",
        strokeWidth: 1,
        roughness: 0,
        label: { text: "Bulk export", fontSize: 8.36 },
      },
      {
        type: "ellipse",
        id: e5,
        x: X(1393),
        y: Y(309),
        width: 33,
        height: 30,
        backgroundColor: "#e6fcf5",
        strokeWidth: 1,
        roughness: 1,
        label: { text: "Yes", fontSize: 8.32 },
      },
      {
        type: "arrow",
        id: newId(),
        start: { id: c5 },
        end: { id: e5 },
        strokeWidth: 1,
        roughness: 1,
      },
      {
        type: "text",
        id: newId(),
        x: X(1444),
        y: Y(309),
        text: "UNLOAD / CTAS to S3, replication\n(the only pattern that copies data)",
        fontSize: 7,
      },
    ],
    { family: 6 },
  );
  const row5 = added.slice(-6);
  const r5 = newId();
  for (const e of row5) {
    e.groupIds = [r5, ...rowGroups, g];
  }
  add(
    [
      {
        type: "text",
        id: newId(),
        x: X(1059),
        y: Y(112),
        text: "pattern                                                                    copy?      mechanism",
        fontSize: 7,
        strokeColor: "#868e96",
      },
    ],
    { inner: rowGroups[0] ?? null },
  );

  // 6. Right bottom: comparisons & decision guide
  setText(pick("f9hJLa9Q"), "- Comparisons & Decision Guide");
  const table = [
    ["If the scenario says...", "Choose...", "Because..."],
    [
      "store all raw data cheaply, any format,\nreprocess later",
      "S3 data lake +\nGlue Data Catalog",
      "schema-on-read,\ndurable, low cost",
    ],
    [
      "complex SQL, BI dashboards, consistent\nperformance at high concurrency",
      "Amazon Redshift",
      "MPP columnar\nwarehouse",
    ],
    [
      "updates/deletes and time travel on\nlake data",
      "Iceberg tables or\nS3 Tables",
      "ACID lakehouse\ntable format",
    ],
    [
      "domains own their data, central\ndiscovery and approval",
      "SageMaker Catalog +\nLF cross-account",
      "data mesh, federated\ngovernance",
    ],
    [
      "share live Redshift data with another\naccount, no copies",
      "Redshift data\nsharing",
      "zero-copy, consistent\nreads",
    ],
    [
      "column-level permissions on S3 data\nfor Athena users",
      "Lake Formation",
      "fine-grained permissions\nin one place",
    ],
  ];
  const cols = [1072, 1300, 1450];
  const inputs = [
    {
      type: "rectangle",
      id: newId(),
      x: X(1062),
      y: Y(400),
      width: 532,
      height: 178,
      backgroundColor: "#ffffff",
      strokeColor: "#ced4da",
      strokeWidth: 1,
      roughness: 0,
    },
  ];
  table.forEach((row, r) => {
    row.forEach((cell, c) => {
      inputs.push({
        type: "text",
        id: newId(),
        x: X(cols[c]),
        y: Y(406 + r * 24),
        text: cell,
        fontSize: r === 0 ? 7.5 : 6.8,
        strokeColor: r === 0 ? "#1971c2" : "#1e1e1e",
      });
    });
  });
  add(inputs, { family: 6 });

  const left = inMat.filter(
    (e) => !e.isDeleted && e.type === "text" && e.text.trim() === "- Template",
  ).length;
  return { added: added.length, template_slots_left: left };
};

if (dryRun) {
  const scene = JSON.parse(
    readFileSync(`${process.env.HOME}/drawings/${TARGET}.excalidraw`, "utf8"),
  );
  console.log(fill(scene));
  const out = process.argv[process.argv.indexOf("--dry-run") + 1];
  if (out && !out.startsWith("--")) {
    writeFileSync(out, JSON.stringify(scene));
  }
} else {
  console.log(await createClient("http://localhost:3000").modify(TARGET, fill));
}
