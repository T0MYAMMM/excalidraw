/* eslint-disable no-console -- CLI script that reports to stdout */
// Puts each purple section (box + everything inside it) into its own
// Excalidraw group so it moves as one. Sections already grouped are skipped.
// Usage: node group_sections.mjs <drawing> [--dry-run]
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";

const M = resolve(import.meta.dirname, "../mcp-server");
const { createClient } = await import(join(M, "client.mjs"));

const [target] = process.argv.slice(2);
const dryRun = process.argv.includes("--dry-run");
const BOX_COLOUR = "#f3f0ff";

const bbox = (e) => {
  if (e.type === "arrow" || e.type === "line") {
    const xs = e.points.map((p) => e.x + p[0]);
    const ys = e.points.map((p) => e.y + p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  return [e.x, e.y, e.x + e.width, e.y + e.height];
};

/** Adds a section group to every ungrouped section; returns a summary. */
export const groupSections = (elements) => {
  const live = elements.filter((e) => !e.isDeleted);
  const boxes = live.filter(
    (e) =>
      e.type === "rectangle" &&
      Math.abs(e.width - 660) < 5 &&
      Math.abs(e.height - 589) < 5 &&
      e.backgroundColor.toLowerCase() === BOX_COLOUR,
  );
  let grouped = 0;
  let skipped = 0;
  for (const box of boxes) {
    const [x1, y1, x2, y2] = bbox(box);
    const inside = live.filter((e) => {
      if (e === box || e.containerId) {
        return false;
      }
      const [a, b, c, d] = bbox(e);
      return x1 - 1 <= a && c <= x2 + 1 && y1 - 1 <= b && d <= y2 + 1;
    });
    const ids = new Set([box.id, ...inside.map((e) => e.id)]);
    for (const e of live) {
      if (e.containerId && ids.has(e.containerId)) {
        ids.add(e.id);
      }
    }
    const members = live.filter((e) => ids.has(e.id));
    if (members.some((e) => e.groupIds?.length)) {
      skipped++;
      continue;
    }
    const groupId = randomBytes(10).toString("base64url");
    for (const e of members) {
      e.groupIds = [...(e.groupIds ?? []), groupId]; // outermost group last
      e.version = (e.version ?? 1) + 1;
      e.versionNonce = Math.floor(Math.random() * 2 ** 31);
      e.updated = Date.now();
    }
    grouped++;
  }
  return { boxes: boxes.length, grouped, skipped };
};

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  if (dryRun) {
    const { readFileSync } = await import("node:fs");
    const scene = JSON.parse(
      readFileSync(`${process.env.HOME}/drawings/${target}.excalidraw`, "utf8"),
    );
    console.log(groupSections(scene.elements));
  } else {
    console.log(
      await createClient("http://localhost:3000").modify(target, (scene) =>
        groupSections(scene.elements),
      ),
    );
  }
}
