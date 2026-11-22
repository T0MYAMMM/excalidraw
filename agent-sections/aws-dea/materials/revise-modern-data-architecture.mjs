/* eslint-disable no-console -- one-off revision script, reports to stdout */
// Revision of material 3 (Modern Data Architectures), after Thomas moved blocks:
// - Architecture Pattern: the lesson's flowchart (Producers / Governance /
//   Consumers groups with labelled arrows) under its heading.
// - Data Sharing Patterns: a compact text table (pattern | mechanism | copy?).
// - Comparisons & Decision Guide: one line per row, columns sized to the text.
// Blocks are found by position under their heading (ids change on browser save).
// Usage: node revise-modern-data-architecture.mjs [--dry-run [out.excalidraw]]
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const M = resolve(import.meta.dirname, "../../../mcp-server");
const { createClient } = await import(join(M, "client.mjs"));
const { addElements } = await import(join(M, "elements.mjs"));

const TARGET = "aws-data-engineer-associate";
const dryIdx = process.argv.indexOf("--dry-run");
const newId = () => randomBytes(10).toString("base64url");
const NUNITO = 6;
const W = 0.49; // Nunito width per font-size unit (matches the rendered text)

const revise = (scene) => {
  const live = scene.elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const box = live
    .filter(
      (e) =>
        e.type === "rectangle" &&
        e.backgroundColor.toLowerCase() === "#fff4e6" &&
        e.width > 1000 &&
        !e.id.startsWith("legend-"),
    )
    .sort((a, b) => a.y - b.y)[2];
  const g = box.groupIds.at(-1);
  const inMat = live.filter((e) => (e.groupIds ?? []).includes(g) && e !== box);
  const bb = (e) => {
    if (e.type === "arrow" || e.type === "line") {
      const xs = e.points.map((p) => e.x + p[0]);
      const ys = e.points.map((p) => e.y + p[1]);
      return [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys),
      ];
    }
    return [e.x, e.y, e.x + e.width, e.y + e.height];
  };
  const heading = (start) => {
    const h = inMat.find((e) => e.type === "text" && e.text.startsWith(start));
    if (!h) {
      throw new Error(`heading "${start}" not found`);
    }
    return h;
  };
  const touch = (e) => {
    e.version = (e.version ?? 1) + 1;
    e.versionNonce = Math.floor(Math.random() * 2 ** 31);
    e.updated = Date.now();
  };
  // delete every element of the material inside a region (and bound labels)
  const clear = (x1, y1, x2, y2, keep = []) => {
    const doomed = new Set();
    for (const e of inMat) {
      if (keep.includes(e) || e.containerId) {
        continue;
      }
      const [a, b, c, d] = bb(e);
      if (a >= x1 && c <= x2 && b >= y1 && d <= y2) {
        doomed.add(e.id);
      }
    }
    for (const e of live) {
      if (e.containerId && doomed.has(e.containerId)) {
        doomed.add(e.id);
      }
    }
    for (const id of doomed) {
      byId.get(id).isDeleted = true;
      touch(byId.get(id));
    }
    return doomed.size;
  };
  const added = [];
  const add = (inputs, family) => {
    const before = scene.elements.length;
    addElements(scene.elements, inputs);
    const fresh = scene.elements.slice(before);
    const inner = newId();
    for (const e of fresh) {
      e.groupIds = [inner, g];
      if (family && e.type === "text") {
        e.fontFamily = family;
      }
    }
    added.push(...fresh);
    return fresh;
  };
  // a text table: one multi-line text per column, widths from the content
  const textTable = (x, y, rows, fontSize, maxWidth) => {
    let fs = fontSize;
    const widths = () =>
      rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)) * fs * W);
    const gap = () => fs * 1.6;
    while (
      widths().reduce((a, b) => a + b, 0) + gap() * (rows[0].length - 1) >
        maxWidth &&
      fs > 5.5
    ) {
      fs -= 0.25;
    }
    const inputs = [];
    let cx = x;
    widths().forEach((w, c) => {
      // header line in blue as its own text, body below
      inputs.push({
        type: "text",
        id: newId(),
        x: cx,
        y,
        text: rows[0][c],
        fontSize: fs,
        strokeColor: "#1971c2",
      });
      inputs.push({
        type: "text",
        id: newId(),
        x: cx,
        y: y + fs * 1.25 + 2,
        text: rows
          .slice(1)
          .map((r) => r[c])
          .join("\n"),
        fontSize: fs,
      });
      cx += w + gap();
    });
    return {
      inputs,
      width: cx - gap() - x,
      height: rows.length * fs * 1.25 + 2,
      fontSize: fs,
    };
  };

  const rel = (dx, dy) => [box.x + dx, box.y + dy];
  const right = box.x + box.width - 14;

  // --- 1. Data Sharing Patterns: compact text table ---------------------------
  const share = heading("- Data Sharing Patterns");
  const comp = heading("- Comparisons & Decision Guide");
  const sharedCleared = clear(
    share.x - 20,
    share.y + share.height + 2,
    box.x + box.width + 2,
    comp.y - 4,
    [share, comp],
  );
  const shareTable = textTable(
    share.x,
    share.y + share.height + 10,
    [
      ["Pattern", "Mechanism", "Copy?"],
      [
        "Centralized lake",
        "one account holds all data; Lake Formation grants to consumers",
        "No",
      ],
      [
        "Hub-and-spoke / mesh",
        "producers own data; central catalog; cross-account LF grants via AWS RAM",
        "No",
      ],
      [
        "Warehouse to warehouse",
        "Redshift data sharing (same/cross-account, cross-Region); live, read-only",
        "No",
      ],
      [
        "External / third-party",
        "AWS Data Exchange (files, APIs, Redshift datashares, S3 data access)",
        "Depends",
      ],
      ["Bulk export", "UNLOAD / CTAS to S3, replication", "Yes"],
    ],
    8,
    right - share.x,
  );
  add(shareTable.inputs, NUNITO);

  // --- 2. Comparisons: one line per row, tight columns ------------------------
  const compCleared = clear(
    comp.x - 20,
    comp.y + comp.height + 2,
    box.x + box.width + 2,
    box.y + box.height + 2,
    [comp],
  );
  const compRows = [
    ["If the scenario says...", "Choose...", "Because..."],
    [
      "store all raw data cheaply, any format, reprocess later",
      "S3 data lake + Glue Data Catalog",
      "schema-on-read, durable, low cost",
    ],
    [
      "complex SQL, BI dashboards, high concurrency",
      "Amazon Redshift",
      "MPP columnar warehouse",
    ],
    [
      "updates/deletes and time travel on lake data",
      "Iceberg tables or S3 Tables",
      "ACID lakehouse table format",
    ],
    [
      "domains own data, central discovery and approval",
      "SageMaker Catalog + LF cross-account",
      "data mesh, federated governance",
    ],
    [
      "share live Redshift data with another account, no copies",
      "Redshift data sharing",
      "zero-copy, consistent reads",
    ],
    [
      "column-level permissions on S3 data for Athena users",
      "Lake Formation",
      "fine-grained permissions in one place",
    ],
  ];
  const compTable = textTable(
    comp.x + 8,
    comp.y + comp.height + 14,
    compRows,
    8,
    right - comp.x - 16,
  );
  add(
    [
      {
        type: "rectangle",
        id: newId(),
        x: comp.x,
        y: comp.y + comp.height + 6,
        width: compTable.width + 16,
        height: compTable.height + 14,
        backgroundColor: "#ffffff",
        strokeColor: "#ced4da",
        strokeWidth: 1,
        roughness: 0,
      },
      ...compTable.inputs,
    ],
    NUNITO,
  );

  // --- 3. Architecture Pattern: the lesson's flowchart --------------------------
  const arch = heading("- Architecture Pattern");
  arch.text = arch.originalText =
    "- Architecture Pattern: data mesh with federated governance";
  arch.width = arch.text.length * arch.fontSize * 0.62;
  touch(arch);
  const archCleared = clear(
    arch.x - 10,
    arch.y + arch.height + 2,
    comp.x - 12,
    box.y + box.height + 2,
    [arch],
  );
  // Fit above the Exam Tips text when there is room (full width); otherwise
  // start right of it and scale the layout to the remaining width.
  const tips = inMat.filter(
    (e) =>
      !e.isDeleted && e.type === "text" && e.text.startsWith('1. "No copies'),
  );
  const tipsTop = Math.min(Infinity, ...tips.map((t) => t.y));
  const tipsRight = Math.max(
    0,
    ...tips.map(
      (t) =>
        t.x +
        Math.max(...t.text.split("\n").map((l) => l.length)) * t.fontSize * W,
    ),
  );
  const ay = arch.y + arch.height + 10;
  const roomAbove = tipsTop - 6 - ay;
  const fitsAbove = roomAbove >= 115 || tipsRight < arch.x;
  const ax = fitsAbove ? arch.x : Math.max(arch.x, tipsRight + 14);
  const k = Math.min(1, (comp.x - 12 - ax) / 430);
  const H = Math.min(
    fitsAbove && tipsRight >= arch.x ? roomAbove : box.y + box.height - 10 - ay,
    150,
  );
  const frame = (x, y, w, h, title) => [
    {
      type: "rectangle",
      id: newId(),
      x,
      y,
      width: w,
      height: h,
      backgroundColor: "transparent",
      strokeColor: "#adb5bd",
      strokeWidth: 1,
      strokeStyle: "dashed",
      roughness: 0,
    },
    {
      type: "text",
      id: newId(),
      x: x + 6,
      y: y + 4,
      text: title,
      fontSize: 8,
      strokeColor: "#495057",
    },
  ];
  const node = (id, x, y, w, h, text) => ({
    type: "rectangle",
    id,
    x,
    y,
    width: w,
    height: h,
    backgroundColor: "#e6fcf5",
    strokeWidth: 1,
    roughness: 0,
    label: { text, fontSize: 7.5 },
  });
  const ids = { p1: newId(), p2: newId(), c: newId(), lf: newId(), a: newId() };
  const NH = 28; // node height (two label lines)
  const rowTop = ay + 18;
  const rowBottom = ay + H - NH - 6;
  const rowMid = (rowTop + rowBottom) / 2;
  const nodes = [
    ...frame(ax, ay, 130 * k, H, "Producers"),
    ...frame(ax + 160 * k, ay, 120 * k, H, "Governance"),
    ...frame(ax + 310 * k, ay, 120 * k, H, "Consumers"),
    // rows: top = Sales + SageMaker Catalog, middle = Lake Formation,
    // bottom = Finance + Analytics, so no arrow crosses a box
    node(
      ids.p1,
      ax + 10 * k,
      rowTop,
      110 * k,
      NH,
      "Sales domain account:\nS3 + Glue Catalog",
    ),
    node(
      ids.p2,
      ax + 10 * k,
      rowBottom,
      110 * k,
      NH,
      "Finance domain\naccount: Redshift",
    ),
    node(
      ids.c,
      ax + 170 * k,
      rowTop,
      100 * k,
      NH,
      "SageMaker Catalog\n(business catalog)",
    ),
    node(
      ids.lf,
      ax + 170 * k,
      rowMid,
      100 * k,
      NH,
      "Lake Formation\npermissions",
    ),
    node(
      ids.a,
      ax + 314 * k,
      rowBottom,
      112 * k,
      NH,
      "Analytics account: Athena\n/ Redshift / QuickSight",
    ),
  ];
  const edge = (from, to, text) => ({
    type: "arrow",
    id: newId(),
    start: { id: from },
    end: { id: to },
    strokeWidth: 1,
    roughness: 0,
    label: { text, fontSize: 6.5 },
  });
  add(nodes, NUNITO);
  add(
    [
      edge(ids.p1, ids.c, "publish"),
      edge(ids.p2, ids.c, "publish"),
      edge(ids.a, ids.c, "search & subscribe"),
      edge(ids.c, ids.lf, "approved grant"),
      edge(ids.lf, ids.a, "cross-account share"),
      edge(ids.p2, ids.a, "datashare"),
    ],
    NUNITO,
  );

  return {
    cleared: { share: sharedCleared, comp: compCleared, arch: archCleared },
    added: added.length,
    shareFont: shareTable.fontSize,
    compFont: compTable.fontSize,
    diagram: { x: Math.round(ax - box.x), scale: Math.round(k * 100) / 100 },
    rel,
  };
};

if (dryIdx > 0) {
  const scene = JSON.parse(
    readFileSync(`${process.env.HOME}/drawings/${TARGET}.excalidraw`, "utf8"),
  );
  const r = revise(scene);
  delete r.rel;
  console.log(r);
  const out = process.argv[dryIdx + 1];
  if (out) {
    writeFileSync(out, JSON.stringify(scene));
  }
} else {
  const r = await createClient("http://localhost:3000").modify(TARGET, revise);
  delete r.rel;
  console.log(r);
}
