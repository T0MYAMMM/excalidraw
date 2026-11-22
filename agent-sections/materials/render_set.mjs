/* eslint-disable no-console -- CLI script that reports to stdout */
// Renders several material specs in one versioned write.
// Usage: node render_set.mjs <drawing> <specs-dir> <row,row,...> [--dry-run [out]]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const M = resolve(import.meta.dirname, "../../mcp-server");
const { createClient } = await import(join(M, "client.mjs"));
const { renderMaterial } = await import(
  join(import.meta.dirname, "render_material.mjs")
);

const [target, specsDir, rowsArg] = process.argv.slice(2);
const rows = rowsArg.split(",").map(Number);
const files = readdirSync(specsDir).filter((f) => /^\d+-.+\.json$/.test(f));
const specFor = (row) => {
  const f = files.find((x) => Number(x.split("-")[0]) === row);
  if (!f) {
    throw new Error(`no spec for material ${row}`);
  }
  return JSON.parse(readFileSync(join(specsDir, f), "utf8"));
};
const renderAll = (scene) =>
  rows.map((r) => renderMaterial(scene, r, specFor(r)));
const dryIdx = process.argv.indexOf("--dry-run");
if (dryIdx > 0) {
  const scene = JSON.parse(
    readFileSync(`${process.env.HOME}/drawings/${target}.excalidraw`, "utf8"),
  );
  console.log(renderAll(scene));
  if (process.argv[dryIdx + 1]) {
    writeFileSync(process.argv[dryIdx + 1], JSON.stringify(scene));
  }
} else {
  console.log(
    await createClient("http://localhost:3000").modify(target, renderAll),
  );
}
