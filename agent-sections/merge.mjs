// Merges the validated sections of a set into a target drawing, one column
// per services.json "col", each section's box behind its own content.
// Usage: node merge.mjs <set-dir> <target-drawing> [--dry-run]
// Run `python3 -I check_all.py <set-dir>` first: it writes passed.json.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const M = resolve(import.meta.dirname, "../mcp-server");
const { createClient } = await import(join(M, "client.mjs"));
const { addElements } = await import(join(M, "elements.mjs"));

const [setDir, target] = process.argv.slice(2);
const dryRun = process.argv.includes("--dry-run");
const layout = JSON.parse(readFileSync(join(setDir, "layout.json"), "utf8"));
const services = JSON.parse(
  readFileSync(join(setDir, "services.json"), "utf8"),
);
const passed = new Set(
  JSON.parse(readFileSync(join(setDir, "passed.json"), "utf8")),
);
const DRAWINGS = `${process.env.HOME}/drawings`;
const SRC_BOX = { x: 5575, y: -9590 }; // where agents draw each section

const missing = services.filter((s) => !passed.has(s.slug)).map((s) => s.slug);
if (missing.length) throw new Error(`not validated: ${missing.join(", ")}`);

const nextRow = [...layout.firstRow];
const sections = services.map((s) => {
  const scene = JSON.parse(
    readFileSync(join(DRAWINGS, `svc-${s.slug}.excalidraw`), "utf8"),
  );
  return {
    slug: s.slug,
    col: s.col,
    row: nextRow[s.col]++,
    elements: scene.elements.filter((e) => !e.isDeleted),
  };
});

const prepare = ({ slug, col, row, elements }, taken) => {
  const dx = layout.colX[col] - SRC_BOX.x;
  const dy = layout.rowY0 + row * layout.rowStep - SRC_BOX.y;
  const ids = new Map(
    elements.map((e) => [
      e.id,
      e.id.startsWith(`${slug}-`) && !taken.has(e.id)
        ? e.id
        : `${slug}-${e.id}`,
    ]),
  );
  const map = (id) => ids.get(id) ?? id;
  const out = elements.map((e) => {
    const c = structuredClone(e);
    c.id = map(e.id);
    c.x += dx;
    c.y += dy;
    c.index = null; // the editor assigns fresh fractional indices
    if (c.containerId) c.containerId = map(c.containerId);
    if (c.boundElements)
      c.boundElements = c.boundElements.map((b) => ({ ...b, id: map(b.id) }));
    for (const k of ["startBinding", "endBinding"])
      if (c[k]) c[k] = { ...c[k], elementId: map(c[k].elementId) };
    return c;
  });
  const box = out.find(
    (e) =>
      e.type === "rectangle" &&
      Math.abs(e.width - 660) < 5 &&
      Math.abs(e.height - 589) < 5,
  );
  return [box, ...out.filter((e) => e !== box)]; // box first = behind
};

const edit = (scene) => {
  if (scene.elements.some((e) => e.id === "svc-heading-0" && !e.isDeleted))
    throw new Error("already merged");
  const taken = new Set(scene.elements.map((e) => e.id));
  const added = [];
  for (const s of sections) {
    for (const e of prepare(s, taken)) {
      if (taken.has(e.id)) throw new Error(`duplicate id ${e.id}`);
      taken.add(e.id);
      added.push(e);
    }
  }
  const headings = [];
  addElements(
    headings,
    layout.headings.map((text, i) => ({
      type: "text",
      id: `svc-heading-${i}`,
      x: layout.colX[i],
      y: layout.headingY,
      text,
      fontSize: 28,
    })),
  );
  scene.elements.push(...headings, ...added);
  return {
    sections: sections.length,
    elements: added.length + headings.length,
    rows: sections.map((s) => `${s.slug}:c${s.col}r${s.row}`).join(" "),
  };
};

if (dryRun) {
  console.log(
    JSON.stringify(
      edit(
        JSON.parse(
          readFileSync(join(DRAWINGS, `${target}.excalidraw`), "utf8"),
        ),
      ),
    ),
  );
} else {
  console.log(
    JSON.stringify(
      await createClient("http://localhost:3000").modify(target, edit),
    ),
  );
}
