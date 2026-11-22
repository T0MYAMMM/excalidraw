/* eslint-disable no-console -- CLI script that reports to stdout */
// Makes every row of each grid table in a material use the same column
// widths (the header row's), aligned to the header's left edge. Grid tables
// are groups of sharp, light-grey-bordered cell boxes (see render_blocks.mjs).
// Usage: node equalize_tables.mjs <drawing> <row,row,...> [--dry-run]
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const M = resolve(import.meta.dirname, "../../mcp-server");
const { createClient } = await import(join(M, "client.mjs"));
const PAD = 5;

export const equalizeTables = (scene, row) => {
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
    .sort((a, b) => a.y - b.y)[row - 1];
  const g = box.groupIds.at(-1);
  const cells = live.filter(
    (e) =>
      e.type === "rectangle" &&
      (e.groupIds ?? []).includes(g) &&
      e.strokeColor === "#ced4da" &&
      !e.roundness &&
      (e.boundElements ?? []).some((b) => byId.get(b.id)?.type === "text"),
  );
  // tables = cells sharing their innermost group
  const tables = new Map();
  for (const c of cells) {
    const key = c.groupIds[0];
    tables.set(key, [...(tables.get(key) ?? []), c]);
  }
  const report = [];
  for (const tcells of tables.values()) {
    // rows by y (cells of one row start within a few px of each other)
    const rows = [];
    for (const c of [...tcells].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const rowOf = rows.find((r) => Math.abs(r[0].y - c.y) < 4);
      if (rowOf) {
        rowOf.push(c);
      } else {
        rows.push([c]);
      }
    }
    rows.forEach((r) => r.sort((a, b) => a.x - b.x));
    const header = rows[0];
    const widths = header.map((c) => c.width);
    const x0 = header[0].x;
    let changed = 0;
    for (const r of rows) {
      if (r.length !== widths.length) {
        continue; // irregular row: leave it alone
      }
      let x = x0;
      for (const [i, c] of r.entries()) {
        if (Math.abs(c.x - x) > 0.5 || Math.abs(c.width - widths[i]) > 0.5) {
          c.x = x;
          c.width = widths[i];
          c.version = (c.version ?? 1) + 1;
          c.updated = Date.now();
          const label = byId.get(
            (c.boundElements ?? []).find((b) => byId.get(b.id)?.type === "text")
              ?.id,
          );
          if (label) {
            label.x = c.x + PAD;
            label.width = c.width - PAD * 2;
            label.version = (label.version ?? 1) + 1;
          }
          changed++;
        }
        x += widths[i];
      }
    }
    report.push({
      rows: rows.length,
      cols: widths.length,
      widths: widths.map((w) => Math.round(w)),
      cells_fixed: changed,
    });
  }
  return { row, tables: report };
};

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const [target, rowsArg] = process.argv.slice(2);
  const rows = rowsArg.split(",").map(Number);
  const run = (scene) => rows.map((r) => equalizeTables(scene, r));
  if (process.argv.includes("--dry-run")) {
    console.log(
      JSON.stringify(
        run(
          JSON.parse(
            readFileSync(
              `${process.env.HOME}/drawings/${target}.excalidraw`,
              "utf8",
            ),
          ),
        ),
      ),
    );
  } else {
    console.log(
      JSON.stringify(
        await createClient("http://localhost:3000").modify(target, run),
      ),
    );
  }
}
