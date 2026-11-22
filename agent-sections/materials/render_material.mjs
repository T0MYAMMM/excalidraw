/* eslint-disable no-console -- CLI script that reports to stdout */
// Renders a material spec (spec.schema.json) into one lesson's material box,
// replacing the template content. Layout follows material 3 as Thomas tuned it:
//   left:   red title, Core Concepts cards, Exam Tips & Traps
//   middle: 3-step flow, architecture flowchart (dashed groups, labels as texts)
//   right:  facts table and Comparisons & Decision Guide as grid tables
// The box, its title line and its group are kept; new elements join the group.
// Usage: node render_material.mjs <drawing> <row> <spec.json> [--dry-run [out]]
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const M = resolve(import.meta.dirname, "../../mcp-server");
const { createClient } = await import(join(M, "client.mjs"));
const { addElements } = await import(join(M, "elements.mjs"));

const NUNITO = 6;
const EXCALIFONT = 5;
const W = 0.49; // Nunito width per font-size unit
const WX = 0.62; // Excalifont width per font-size unit
const PAD = 5;
const newId = () => randomBytes(10).toString("base64url");

/** Greedy word wrap to a width in px. */
export const wrap = (text, width, fs, perChar = W) => {
  const max = Math.max(4, Math.floor(width / (fs * perChar)));
  const out = [];
  for (const para of String(text).split("\n")) {
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

export const renderMaterial = (scene, row, spec) => {
  const live = scene.elements.filter((e) => !e.isDeleted);
  const mats = live
    .filter(
      (e) =>
        e.type === "rectangle" &&
        e.backgroundColor.toLowerCase() === "#fff4e6" &&
        e.width > 1000 &&
        !e.id.startsWith("legend-"),
    )
    .sort((a, b) => a.y - b.y);
  const box = mats[row - 1];
  if (!box) {
    throw new Error(`no material ${row}`);
  }
  const g = box.groupIds?.at(-1);
  if (!g) {
    throw new Error(`material ${row} is not grouped`);
  }
  const members = live.filter((e) => (e.groupIds ?? []).includes(g));
  const isTitle = (e) =>
    e.type === "text" && e.y < box.y && /^\d+\. /.test(e.text);
  const isChip = (e) =>
    (e.type === "text" && (e.text === "Services:" || e.text.startsWith("↗"))) ||
    (e.link ?? "").includes("?element=");
  const hasTemplate = members.some(
    (e) => e.type === "text" && e.text.trim() === "- Template",
  );
  if (!hasTemplate) {
    throw new Error(
      `material ${row} has no template left; refusing to overwrite Thomas's notes`,
    );
  }
  // remove the template content (keep box, title line, chips)
  let removed = 0;
  for (const e of members) {
    if (e === box || isTitle(e) || isChip(e)) {
      continue;
    }
    e.isDeleted = true;
    e.version = (e.version ?? 1) + 1;
    e.updated = Date.now();
    removed++;
  }

  const X = (dx) => box.x + dx;
  const Y = (dy) => box.y + dy;
  const added = [];
  const add = (inputs, { family, inner = true } = {}) => {
    const start = scene.elements.length;
    addElements(scene.elements, inputs);
    const fresh = scene.elements.slice(start);
    const innerId = inner ? newId() : null;
    for (const e of fresh) {
      e.groupIds = innerId ? [innerId, g] : [g];
      if (family && e.type === "text" && !e.containerId) {
        e.fontFamily = family;
      }
      if (e.type === "text" && !e.containerId) {
        // generous width so the editor never clips the last letters
        const perChar = e.fontFamily === EXCALIFONT ? 0.66 : 0.6;
        e.width =
          Math.max(...e.text.split("\n").map((l) => l.length)) *
          e.fontSize *
          perChar;
      }
    }
    added.push(...fresh);
    return fresh;
  };
  const text = (dx, dy, t, fs, extra = {}) => ({
    type: "text",
    id: newId(),
    x: X(dx),
    y: Y(dy),
    text: t,
    fontSize: fs,
    ...extra,
  });
  const heading = (dx, dy, t, color) =>
    add([text(dx, dy, t, 16, color ? { strokeColor: color } : {})], {
      family: EXCALIFONT,
      inner: false,
    });

  // --- left column -------------------------------------------------------------
  heading(46, 44, `- ${spec.title_line}`, "#e03131");
  heading(46, 77, "- Core Concepts");
  const cTop = 106;
  const cBottom = 440;
  const slot = (cBottom - cTop) / spec.concepts.length;
  spec.concepts.forEach((c, i) => {
    const y = cTop + i * slot;
    const lines = wrap(c.text, 320, 11.33);
    const blockText = [text(194, y + 1, lines.join("\n"), 11.33)];
    if (c.tag) {
      blockText.push(
        text(194, y + 3 + lines.length * 14.2, c.tag, 11.33, {
          strokeColor: "#e03131",
        }),
      );
    }
    add(
      [
        {
          type: "rectangle",
          id: newId(),
          x: X(64),
          y: Y(y),
          width: 112,
          height: 35,
          backgroundColor: "#1971c2",
          strokeColor: "#ffffff",
          strokeWidth: 1,
          roughness: 0,
          label: { text: c.name, fontSize: 9.86, strokeColor: "#ffffff" },
        },
        ...blockText,
      ],
      { family: NUNITO },
    );
    if (c.keyword) {
      add(
        [
          text(
            120 - (c.keyword.length * 11.33 * WX) / 2,
            y + 40,
            c.keyword,
            11.33,
          ),
        ],
        { family: EXCALIFONT },
      );
    }
  });
  heading(46, 460, "- Exam Tips & Traps");
  const tipLines = spec.tips.flatMap((t, i) =>
    wrap(`${i + 1}. ${t}`, 490, 9.5).map((l, k) => (k ? `    ${l}` : l)),
  );
  add([text(64, 486, tipLines.join("\n"), 9.5)], { family: NUNITO });

  // --- middle column: steps ------------------------------------------------------
  heading(604, 79, `- ${spec.steps.heading}`);
  const stepFills = ["#e7f5ff", "#d3f9d8", "#fff3bf"];
  const stepIds = spec.steps.items.map(() => newId());
  add(
    [
      ...spec.steps.items.map((s, i) => ({
        type: "rectangle",
        id: stepIds[i],
        x: X(601),
        y: Y(112 + i * 58),
        width: 98,
        height: 33,
        backgroundColor: stepFills[i],
        strokeWidth: 1,
        roughness: 0,
        label: { text: s.label, fontSize: 9.86 },
      })),
      ...[0, 1].map((i) => ({
        type: "arrow",
        id: newId(),
        start: { id: stepIds[i] },
        end: { id: stepIds[i + 1] },
        strokeWidth: 1,
        roughness: 1,
      })),
      ...spec.steps.items.map((s, i) =>
        text(710, 114 + i * 58, wrap(s.text, 285, 9.3).join("\n"), 9.3),
      ),
    ],
    { family: NUNITO },
  );

  // --- middle column: architecture flowchart --------------------------------------
  const dHead = wrap(
    `- Architecture Pattern: ${spec.diagram.heading}`,
    420,
    16,
    WX,
  );
  add([text(591, 294, dHead.join("\n"), 16)], {
    family: EXCALIFONT,
    inner: false,
  });
  const dTop = 294 + dHead.length * 20 + 8;
  const dLeft = 575;
  const dWidth = 430;
  const dBottom = 582;
  const groups = spec.diagram.groups;
  const gap = 18;
  const fw = (dWidth - gap * (groups.length - 1)) / groups.length;
  const fh = dBottom - dTop;
  // choose the node order inside each group with the fewest crossings
  // (arrow through another node counts 3, arrow over arrow counts 1)
  const nodeBox = (gi, ni, n) => {
    const fx = dLeft + gi * (fw + gap);
    const cy = dTop + 18 + ((ni + 0.5) * (fh - 22)) / n;
    return {
      x1: fx + 8,
      x2: fx + fw - 8,
      y1: cy - 15,
      y2: cy + 15,
      cx: fx + fw / 2,
      cy,
    };
  };
  const segHitsBox = (a, b, r) => {
    // Liang-Barsky clip of segment a-b against rect r (slightly shrunk)
    const [x1, y1, x2, y2] = [r.x1 + 2, r.y1 + 2, r.x2 - 2, r.y2 - 2];
    let t0 = 0;
    let t1 = 1;
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    for (const [pp, q] of [
      [-dx, a.cx - x1],
      [dx, x2 - a.cx],
      [-dy, a.cy - y1],
      [dy, y2 - a.cy],
    ]) {
      if (pp === 0) {
        if (q < 0) {
          return false;
        }
      } else {
        const t = q / pp;
        if (pp < 0) {
          t0 = Math.max(t0, t);
        } else {
          t1 = Math.min(t1, t);
        }
        if (t0 > t1) {
          return false;
        }
      }
    }
    return true;
  };
  const cross = (p1, p2, p3, p4) => {
    const d = (a, b, c) =>
      (b.cx - a.cx) * (c.cy - a.cy) - (b.cy - a.cy) * (c.cx - a.cx);
    return (
      d(p1, p2, p3) * d(p1, p2, p4) < 0 && d(p3, p4, p1) * d(p3, p4, p2) < 0
    );
  };
  const perms = (arr) =>
    arr.length <= 1
      ? [arr]
      : arr.flatMap((x, i) =>
          perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map((r) => [
            x,
            ...r,
          ]),
        );
  const options = groups.map((grp) => perms(grp.nodes.map((_, i) => i)));
  let best = null;
  const total = options.reduce((n, o) => n * o.length, 1);
  for (let k = 0; k < total; k++) {
    let rest = k;
    const choice = options.map((o) => {
      const c = o[rest % o.length];
      rest = Math.floor(rest / o.length);
      return c;
    });
    const where = new Map();
    choice.forEach((order, gi) =>
      order.forEach((orig, pos) =>
        where.set(groups[gi].nodes[orig].id, nodeBox(gi, pos, order.length)),
      ),
    );
    const segs = spec.diagram.edges
      .filter((e) => where.has(e.from) && where.has(e.to))
      .map((e) => [e.from, e.to, where.get(e.from), where.get(e.to)]);
    let score = 0;
    for (const [f, t, a, b] of segs) {
      for (const [id, r] of where) {
        if (id !== f && id !== t && segHitsBox(a, b, r)) {
          score += 3;
        }
      }
    }
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const [f1, t1, a1, b1] = segs[i];
        const [f2, t2, a2, b2] = segs[j];
        if (
          ![f2, t2].includes(f1) &&
          ![f2, t2].includes(t1) &&
          cross(a1, b1, a2, b2)
        ) {
          score += 1;
        }
      }
    }
    if (!best || score < best.score) {
      best = { score, choice };
    }
  }
  const orderedGroups = groups.map((grp, gi) => ({
    ...grp,
    nodes: best.choice[gi].map((i) => grp.nodes[i]),
  }));
  const nodeId = new Map();
  const frameInputs = [];
  const nodeInputs = [];
  orderedGroups.forEach((grp, gi) => {
    const fx = dLeft + gi * (fw + gap);
    frameInputs.push(
      {
        type: "rectangle",
        id: newId(),
        x: X(fx),
        y: Y(dTop),
        width: fw,
        height: fh,
        backgroundColor: "transparent",
        strokeColor: "#adb5bd",
        strokeWidth: 1,
        strokeStyle: "dashed",
        roughness: 0,
      },
      text(
        fx + fw / 2 - (grp.title.length * 8 * W) / 2,
        dTop + 4,
        grp.title,
        8,
        { strokeColor: "#495057" },
      ),
    );
    const n = grp.nodes.length;
    const nh = 30;
    const usable = fh - 22;
    grp.nodes.forEach((nd, ni) => {
      const id = newId();
      nodeId.set(nd.id, id);
      const ny = dTop + 18 + ((ni + 0.5) * usable) / n - nh / 2;
      const lines = wrap(nd.label, fw - 18, 7.5);
      nodeInputs.push({
        type: "rectangle",
        id,
        x: X(fx + 8),
        y: Y(ny),
        width: fw - 16,
        height: Math.max(nh, lines.length * 9.4 + 8),
        backgroundColor: "#e6fcf5",
        strokeWidth: 1,
        roughness: 0,
        label: { text: lines.join("\n"), fontSize: 7.5 },
      });
    });
  });
  const nodeEls = add([...frameInputs, ...nodeInputs], { family: NUNITO });
  for (const e of nodeEls) {
    if (e.type === "text" && e.containerId) {
      e.fontFamily = NUNITO; // small node labels read better in Nunito
    }
  }
  const edgeInputs = [];
  for (const e of spec.diagram.edges) {
    if (!nodeId.has(e.from) || !nodeId.has(e.to)) {
      throw new Error(`edge ${e.from} -> ${e.to} uses an unknown node`);
    }
    edgeInputs.push({
      type: "arrow",
      id: newId(),
      start: { id: nodeId.get(e.from) },
      end: { id: nodeId.get(e.to) },
      strokeWidth: 1,
      roughness: 0,
    });
  }
  const arrows = add(edgeInputs, { family: NUNITO });
  // labels as separate texts next to each arrow's midpoint
  const labelInputs = arrows.map((a, i) => {
    const label = spec.diagram.edges[i].label;
    const p0 = a.points[0];
    const p1 = a.points.at(-1);
    const mx = a.x + (p0[0] + p1[0]) / 2 - box.x;
    const my = a.y + (p0[1] + p1[1]) / 2 - box.y;
    const fs = 6.5;
    const w = label.length * fs * W;
    const horizontal = Math.abs(p1[0] - p0[0]) >= Math.abs(p1[1] - p0[1]);
    return horizontal
      ? text(mx - w / 2, my - fs * 1.25 - 3, label, fs)
      : text(mx + 4, my - (fs * 1.25) / 2, label, fs);
  });
  add(labelInputs, { family: NUNITO });

  // --- right column: grid tables ------------------------------------------------
  const tableInputs = (dx, dy, widths, rows, fs) => {
    const inputs = [];
    const fix = [];
    let cy = dy;
    rows.forEach((r, ri) => {
      const wrapped = r.map((cell, c) => wrap(cell, widths[c] - PAD * 2, fs));
      const rh =
        Math.max(...wrapped.map((l) => l.length)) * fs * 1.25 + PAD * 2 + 2;
      let cx = dx;
      r.forEach((cell, c) => {
        const id = newId();
        inputs.push({
          type: "rectangle",
          id,
          x: X(cx),
          y: Y(cy),
          width: widths[c],
          height: rh,
          backgroundColor: ri === 0 ? "#e7f5ff" : "#ffffff",
          strokeColor: "#ced4da",
          strokeWidth: 1,
          roughness: 0,
          label: {
            text: wrapped[c].join("\n"),
            fontSize: fs,
            strokeColor: ri === 0 ? "#1971c2" : "#1e1e1e",
          },
        });
        fix.push({ id, original: cell, lines: wrapped[c].length });
        cx += widths[c];
      });
      cy += rh;
    });
    return { inputs, fix, bottom: cy };
  };
  const placeTable = (t) => {
    const fresh = add(t.inputs, { family: NUNITO });
    const byNew = new Map(fresh.map((e) => [e.id, e]));
    for (const f of t.fix) {
      const cell = byNew.get(f.id);
      cell.roundness = null;
      const label = fresh.find((e) => e.containerId === f.id);
      label.fontFamily = NUNITO;
      label.textAlign = "left";
      label.verticalAlign = "top";
      label.originalText = f.original;
      label.width = cell.width - PAD * 2;
      label.height = f.lines * label.fontSize * 1.25;
      label.x = cell.x + PAD;
      label.y = cell.y + PAD + 1;
    }
  };
  const rLeft = 1028;
  const rWidth = 1597 - rLeft;
  const colWidths = (rows) => {
    // share the width by each column's longest text, within limits
    const longest = rows[0].map((_, c) =>
      Math.max(...rows.map((r) => (r[c] ?? "").length)),
    );
    const total = longest.reduce((a, b) => a + b, 0);
    const raw = longest.map((l) => Math.max(0.14, Math.min(0.6, l / total)));
    const sum = raw.reduce((a, b) => a + b, 0);
    return raw.map((r) => (r / sum) * rWidth);
  };
  // fit both tables in the column: shrink the font a little if needed
  const factsRows = [spec.table.columns, ...spec.table.rows];
  const decRows = [
    ["If the scenario says...", "Choose...", "Because..."],
    ...spec.decisions.rows,
  ];
  let fs = 8.5;
  let facts;
  let dec;
  for (; fs >= 7; fs -= 0.25) {
    facts = tableInputs(rLeft, 79 + 26, colWidths(factsRows), factsRows, fs);
    dec = tableInputs(
      rLeft,
      facts.bottom + 14 + 26,
      colWidths(decRows),
      decRows,
      fs,
    );
    if (dec.bottom <= 582) {
      break;
    }
  }
  if (dec.bottom > 582) {
    throw new Error(
      `tables don't fit in material ${row} (bottom ${Math.round(
        dec.bottom,
      )}); shorten the spec`,
    );
  }
  heading(rLeft, 79, `- ${spec.table.heading}`);
  placeTable(facts);
  heading(rLeft, facts.bottom + 14, "- Comparisons & Decision Guide");
  placeTable(dec);

  return {
    row,
    removed_template: removed,
    added: added.length,
    table_font: fs,
    diagram_crossings: best.score,
  };
};

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const [target, rowArg, specPath] = process.argv.slice(2);
  const row = Number(rowArg);
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  const dryIdx = process.argv.indexOf("--dry-run");
  if (dryIdx > 0) {
    const scene = JSON.parse(
      readFileSync(`${process.env.HOME}/drawings/${target}.excalidraw`, "utf8"),
    );
    console.log(renderMaterial(scene, row, spec));
    if (process.argv[dryIdx + 1]) {
      writeFileSync(process.argv[dryIdx + 1], JSON.stringify(scene));
    }
  } else {
    console.log(
      await createClient("http://localhost:3000").modify(target, (scene) =>
        renderMaterial(scene, row, spec),
      ),
    );
  }
}
