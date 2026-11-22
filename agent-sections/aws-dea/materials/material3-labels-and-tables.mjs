/* eslint-disable no-console -- one-off script, reports to stdout */
// Material 3 (Modern Data Architectures), after Thomas's relayout:
// 1. Re-adds the architecture arrow labels as separate (unbound) texts next to
//    each arrow's midpoint, matched by the boxes each arrow connects.
// 2. Rebuilds Data Sharing Patterns and Comparisons & Decision Guide as grid
//    tables: one box per cell, text wrapped to the column, each row as tall as
//    its tallest cell, shaded header. (Excalidraw has no table element.)
// Usage: node material3-labels-and-tables.mjs [--dry-run [out.excalidraw]]
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
const W = 0.49; // Nunito width per font-size unit
const PAD = 5; // Excalidraw's bound-text padding

/** Greedy word wrap to `width` px at `fs`. */
const wrap = (text, width, fs) => {
  const max = Math.max(4, Math.floor(width / (fs * W)));
  const out = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > max && line) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
};

const run = (scene) => {
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
  const near = (e) =>
    e.x >= box.x - 10 &&
    e.x <= box.x + box.width + 10 &&
    e.y >= box.y - 60 &&
    e.y <= box.y + box.height + 10;
  const mat = live.filter(near);
  const labelOf = (e) =>
    (e?.boundElements ?? [])
      .map((b) => byId.get(b.id))
      .find((t) => t?.type === "text")?.text ?? "";
  const heading = (start) => {
    const h = mat.find((e) => e.type === "text" && e.text.startsWith(start));
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
  const clear = (x1, y1, x2, y2, keep) => {
    const doomed = new Set();
    for (const e of mat) {
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
  const report = {};

  // --- 1. arrow labels ------------------------------------------------------
  const LABELS = [
    [/^Sales domain/, /^SageMaker Catalog/, "publish"],
    [/^Finance domain/, /^SageMaker Catalog|^Lake Formation/, "publish"],
    [/^Analytics account/, /^SageMaker Catalog/, "search & subscribe"],
    [/^SageMaker Catalog/, /^Lake Formation/, "approved grant"],
    [/^Lake Formation/, /^Analytics account/, "cross-account share"],
    [/^Finance domain/, /^Analytics account/, "datashare"],
  ];
  const arch = heading("- Architecture Pattern");
  const archArrows = mat.filter(
    (e) => e.type === "arrow" && e.y > arch.y && e.startBinding && e.endBinding,
  );
  const labelInputs = [];
  const placed = [];
  for (const a of archArrows) {
    const from = labelOf(byId.get(a.startBinding.elementId));
    const to = labelOf(byId.get(a.endBinding.elementId));
    const rule = LABELS.find(([f, t]) => f.test(from) && t.test(to));
    if (!rule) {
      continue;
    }
    const p0 = a.points[0];
    const p1 = a.points.at(-1);
    const mx = a.x + (p0[0] + p1[0]) / 2;
    const my = a.y + (p0[1] + p1[1]) / 2;
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const len = Math.hypot(dx, dy) || 1;
    // offset to the side: above for mostly horizontal arrows, right for vertical ones
    const fs = 6.5;
    const w = rule[2].length * fs * W;
    const h = fs * 1.25;
    let x;
    let y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      x = mx - w / 2;
      y = my - h - 3;
    } else {
      x = mx + 4;
      y = my - h / 2;
    }
    if (
      Math.abs(dx) > 0 &&
      Math.abs(dy) > 0 &&
      Math.abs(dx / len) > 0.3 &&
      Math.abs(dy / len) > 0.3
    ) {
      // diagonal: beside the midpoint, on the outer side
      x = dy * dx < 0 ? mx + 4 : mx + 4;
      y = my - h - 2;
    }
    labelInputs.push({
      type: "text",
      id: newId(),
      x,
      y,
      text: rule[2],
      fontSize: fs,
    });
    placed.push(`${from.split("\n")[0]} → ${to.split("\n")[0]}: ${rule[2]}`);
  }
  const before = scene.elements.length;
  addElements(scene.elements, labelInputs);
  for (const t of scene.elements.slice(before)) {
    t.fontFamily = NUNITO;
  }
  report.arrow_labels = placed;

  // --- 2. tables ------------------------------------------------------------
  const table = (x, y, colWidths, rows, fs) => {
    const inputs = [];
    const fixups = [];
    let cy = y;
    rows.forEach((row, r) => {
      const wrapped = row.map((cell, c) =>
        wrap(cell, colWidths[c] - PAD * 2, fs),
      );
      const lines = Math.max(...wrapped.map((l) => l.length));
      const rh = lines * fs * 1.25 + PAD * 2 + 2;
      let cx = x;
      row.forEach((cell, c) => {
        const id = newId();
        inputs.push({
          type: "rectangle",
          id,
          x: cx,
          y: cy,
          width: colWidths[c],
          height: rh,
          backgroundColor: r === 0 ? "#e7f5ff" : "#ffffff",
          strokeColor: "#ced4da",
          strokeWidth: 1,
          roughness: 0,
          label: {
            text: wrapped[c].join("\n"),
            fontSize: fs,
            strokeColor: r === 0 ? "#1971c2" : "#1e1e1e",
          },
        });
        fixups.push({ id, original: cell, lines: wrapped[c].length });
        cx += colWidths[c];
      });
      cy += rh;
    });
    return { inputs, fixups, height: cy - y };
  };
  const addTable = (t) => {
    const start = scene.elements.length;
    addElements(scene.elements, t.inputs);
    const fresh = scene.elements.slice(start);
    const gid = newId();
    for (const e of fresh) {
      e.groupIds = [gid];
      if (e.type === "rectangle") {
        e.roundness = null; // sharp grid
      }
    }
    const freshById = new Map(fresh.map((e) => [e.id, e]));
    for (const f of t.fixups) {
      const cell = freshById.get(f.id);
      const label = fresh.find((e) => e.containerId === f.id);
      label.fontFamily = NUNITO;
      label.textAlign = "left";
      label.verticalAlign = "top";
      label.originalText = f.original; // the editor re-wraps from this if the cell is resized
      label.width = cell.width - PAD * 2;
      label.height = f.lines * label.fontSize * 1.25;
      label.x = cell.x + PAD;
      label.y = cell.y + PAD + 1;
    }
    return fresh.length;
  };

  const share = heading("- Data Sharing Patterns");
  const comp = heading("- Comparisons & Decision Guide");
  const right = box.x + box.width - 12;
  const archFrameRight = Math.max(
    ...mat
      .filter((e) => e.type === "rectangle" && e.strokeStyle === "dashed")
      .map((e) => e.x + e.width),
  );
  report.cleared_comp = clear(
    Math.max(comp.x - 30, archFrameRight + 1),
    comp.y + comp.height + 1,
    box.x + box.width + 2,
    box.y + box.height + 2,
    [comp],
  );
  report.cleared_share = clear(
    share.x - 30,
    share.y + share.height + 1,
    box.x + box.width + 2,
    comp.y - 2,
    [share, comp],
  );
  const shareX = share.x;
  const shareRows = [
    ["Pattern", "Mechanism", "Copy?"],
    [
      "Centralized lake",
      "One account holds all data; Lake Formation grants to consumers",
      "No",
    ],
    [
      "Hub-and-spoke / mesh",
      "Producers own data, central catalog/governance account, cross-account LF grants via AWS RAM",
      "No",
    ],
    [
      "Warehouse to warehouse",
      "Redshift data sharing (same account, cross-account, cross-Region)",
      "No (live, read-only)",
    ],
    [
      "External / third-party",
      "AWS Data Exchange (files, APIs, Redshift datashares, S3 data access)",
      "Depends",
    ],
    ["Bulk export", "UNLOAD / CTAS to S3, replication", "Yes"],
  ];
  const shareW = right - shareX;
  const shareTable = table(
    shareX,
    share.y + share.height + 6,
    [shareW * 0.24, shareW * 0.56, shareW * 0.2],
    shareRows,
    8,
  );
  report.share_table_bottom = Math.round(
    share.y + share.height + 6 + shareTable.height - box.y,
  );
  const shareBottom = share.y + share.height + 6 + shareTable.height;
  if (comp.y < shareBottom + 14) {
    comp.y = shareBottom + 14; // keep the comparisons heading clear of the sharing table
    touch(comp);
  }
  report.comp_heading_top = Math.round(comp.y - box.y);
  addTable(shareTable);

  const compX = Math.max(comp.x, archFrameRight + 10);
  const compRows = [
    ["If the scenario says...", "Choose...", "Because..."],
    [
      "store all raw data cheaply, any format, reprocess later",
      "S3 data lake + Glue Data Catalog",
      "schema-on-read, durable and low cost",
    ],
    [
      "complex SQL, BI dashboards, consistent performance at high concurrency",
      "Amazon Redshift",
      "MPP columnar warehouse",
    ],
    [
      "updates/deletes and time travel on lake data",
      "Apache Iceberg tables (Athena/Glue/EMR) or S3 Tables",
      "ACID lakehouse table format",
    ],
    [
      "domains own their data, central discovery and approval",
      "SageMaker Catalog + Lake Formation cross-account",
      "data mesh with federated governance",
    ],
    [
      "share live Redshift data with another account, no copies",
      "Redshift data sharing",
      "zero-copy, transactionally consistent reads",
    ],
    [
      "column-level permissions on S3 data for Athena users",
      "Lake Formation",
      "fine-grained permissions in one place",
    ],
  ];
  const compW = right - compX;
  const compTable = table(
    compX,
    comp.y + comp.height + 6,
    [compW * 0.42, compW * 0.3, compW * 0.28],
    compRows,
    8.5,
  );
  report.comp_table_bottom = Math.round(
    comp.y + comp.height + 6 + compTable.height - box.y,
  );
  addTable(compTable);
  report.box_bottom = Math.round(box.height);
  return report;
};

if (dryIdx > 0) {
  const scene = JSON.parse(
    readFileSync(`${process.env.HOME}/drawings/${TARGET}.excalidraw`, "utf8"),
  );
  console.log(run(scene));
  const out = process.argv[dryIdx + 1];
  if (out) {
    writeFileSync(out, JSON.stringify(scene));
  }
} else {
  console.log(await createClient("http://localhost:3000").modify(TARGET, run));
}
