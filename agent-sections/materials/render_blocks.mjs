/* eslint-disable no-console -- CLI script that reports to stdout */
// Block-based material renderer: each lesson picks the visual blocks that fit
// its content (see blocks.schema.json and the design briefs), instead of one
// fixed layout. Blocks stack in three columns inside the material box
// (left / middle / right, or "middle-right" for wide blocks); text scales down
// a little if a column would overflow.
// Usage: node render_blocks.mjs <drawing> <specs-dir> <row,row,...> [--dry-run [out]]
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const M = resolve(import.meta.dirname, "../../mcp-server");
const { createClient } = await import(join(M, "client.mjs"));
const { addElements } = await import(join(M, "elements.mjs"));

const NUNITO = 6;
const EXCALIFONT = 5;
const W = 0.49; // Nunito width per font-size unit (wrapping)
const WX = 0.62; // Excalifont width per font-size unit (wrapping)
const PAD = 5;
const COLS = {
  left: [46, 540],
  middle: [560, 1030],
  right: [1048, 1597],
  "middle-right": [560, 1597],
};
const MAX_GAP = 90; // most extra space added between two blocks of a column
const TOP = { left: 77, middle: 79, right: 79 };
const BOTTOM = 582;
const MAX_COL_SCALE = 1.4; // a sparse column may grow its text up to this
const newId = () => randomBytes(10).toString("base64url");

const wrap = (text, width, fs, perChar = W) => {
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

/**
 * Lays out one material. Builders return element inputs (absolute coords)
 * plus post-processing hooks; nothing touches the scene until commit().
 */
const layout = (box, spec, sc, tipsFs) => {
  // sc: one scale for all columns, or { left, middle, right }
  const scaleOf = (col) =>
    typeof sc === "number"
      ? sc
      : col === "middle-right"
      ? Math.min(sc.middle, sc.right)
      : sc[col] ?? sc.left;
  let s = scaleOf("left");
  const X = (dx) => box.x + dx;
  const Y = (dy) => box.y + dy;
  const blocks = []; // { inputs, fix: [(fresh) => void], family }
  const T = (x, y, t, fs, extra = {}) => ({
    type: "text",
    id: newId(),
    x: X(x),
    y: Y(y),
    text: t,
    fontSize: fs * s,
    ...extra,
  });
  const rect = (x, y, w, h, extra = {}) => ({
    type: "rectangle",
    id: newId(),
    x: X(x),
    y: Y(y),
    width: w,
    height: h,
    strokeWidth: 1,
    roughness: 0,
    ...extra,
  });
  const arrow = (from, to) => ({
    type: "arrow",
    id: newId(),
    start: { id: from },
    end: { id: to },
    strokeWidth: 1,
    roughness: 0,
  });
  const heading = (x, y, t, inputs, color) => {
    inputs.push(
      T(
        x,
        y,
        `- ${t}`,
        16,
        color
          ? { strokeColor: color, _font: EXCALIFONT }
          : { _font: EXCALIFONT },
      ),
    );
    return 20 * s + 8;
  };
  const cursor = { ...TOP };
  const commitBlock = (inputs) =>
    blocks.push({ inputs, cells: [], col: "title", y: 0, h: 0 });

  // red title in the left column
  {
    const inputs = [];
    heading(46, 44, spec.title_line, inputs, "#e03131");
    commitBlock(inputs);
  }

  const B = {
    concepts(b, x, y, w) {
      const inputs = [];
      let h =
        b.heading === null
          ? 0
          : heading(x, y, b.heading ?? "Core Concepts", inputs);
      for (const c of b.items) {
        const id = newId();
        const cw = 112 * s;
        const tx = x + 30 + cw;
        const lines = wrap(c.text, x + w - tx, 11.33 * s);
        const textH = lines.length * 11.33 * s * 1.25;
        inputs.push(
          rect(x + 18, y + h, cw, 35 * s, {
            id,
            backgroundColor: "#1971c2",
            strokeColor: "#ffffff",
            label: { text: c.name, fontSize: 9.86 * s, strokeColor: "#ffffff" },
          }),
        );
        if (c.keyword) {
          inputs.push(
            T(
              x + 18 + cw / 2 - (c.keyword.length * 11.33 * s * WX) / 2,
              y + h + 39 * s,
              c.keyword,
              11.33,
              { _font: EXCALIFONT },
            ),
          );
        }
        inputs.push(T(tx, y + h + 1, lines.join("\n"), 11.33));
        let itemH = Math.max(c.keyword ? 56 * s : 38 * s, textH + 4);
        if (c.tag) {
          inputs.push(
            T(tx, y + h + 3 + textH, c.tag, 11.33, { strokeColor: "#e03131" }),
          );
          itemH = Math.max(itemH, textH + 20 * s);
        }
        h += itemH + 10;
      }
      return { inputs, h };
    },
    callouts(b, x, y, w) {
      const inputs = [];
      const h = heading(x, y, b.heading, inputs);
      const n = b.items.length;
      const cw = (w - (n - 1) * 10) / n;
      const ch = 66 * s;
      b.items.forEach((it, i) => {
        const cx = x + i * (cw + 10);
        inputs.push(
          rect(cx, y + h, cw, ch, {
            backgroundColor: "#e7f5ff",
            strokeColor: "#1971c2",
          }),
        );
        // value font: as large as the card allows (Excalifont ~0.66 em per char)
        const vfs = Math.min(18 * s, (cw - 14) / (it.value.length * 0.66));
        inputs.push({
          ...T(
            cx + cw / 2 - (it.value.length * vfs * 0.6) / 2,
            y + h + 8,
            it.value,
            18,
            { strokeColor: "#1971c2", _font: EXCALIFONT },
          ),
          fontSize: vfs,
        });
        const lines = wrap(it.label, cw - 10, 9.5 * s);
        lines.forEach((l, k) =>
          inputs.push(
            T(
              cx + cw / 2 - (l.length * 9.5 * s * W) / 2,
              y + h + 34 * s + k * 11.9 * s,
              l,
              9.5,
            ),
          ),
        );
      });
      return { inputs, h: h + ch + 10 };
    },
    compare(b, x, y, w) {
      const inputs = [];
      let h = heading(x, y, b.heading, inputs);
      const pw = (w - 12) / 2;
      const fills = ["#e7f5ff", "#d3f9d8"];
      const sides = [b.left, b.right];
      const bodies = sides.map((side) =>
        side.points.flatMap((p) =>
          wrap(`• ${p}`, pw - 14, 9.5 * s).map((l, k) => (k ? `   ${l}` : l)),
        ),
      );
      const bodyH =
        Math.max(...bodies.map((l) => l.length)) * 9.5 * s * 1.25 + 12;
      sides.forEach((side, i) => {
        const px = x + i * (pw + 12);
        inputs.push(
          rect(px, y + h, pw, 26 * s, {
            backgroundColor: fills[i],
            label: { text: side.title, fontSize: 10 * s },
          }),
        );
        inputs.push(
          rect(px, y + h + 26 * s, pw, bodyH, {
            backgroundColor: "#ffffff",
            strokeColor: "#ced4da",
          }),
        );
        inputs.push(T(px + 7, y + h + 26 * s + 6, bodies[i].join("\n"), 9.5));
      });
      h += 26 * s + bodyH + 6;
      if (b.caption) {
        const lines = wrap(b.caption, w, 9 * s);
        inputs.push(
          T(x, y + h, lines.join("\n"), 9, { strokeColor: "#495057" }),
        );
        h += lines.length * 9 * s * 1.25 + 4;
      }
      return { inputs, h: h + 8 };
    },
    timeline(b, x, y, w) {
      const inputs = [];
      let h = heading(x, y, b.heading, inputs);
      const nameW = b.lanes?.length ? 66 : 0;
      const ax = x + nameW + 8;
      const aw = w - nameW - 16;
      const lanes = b.lanes ?? [];
      const laneH = 22 * s;
      // lanes of bars (e.g. window types)
      lanes.forEach((lane, i) => {
        const ly = y + h + i * laneH;
        inputs.push(T(x, ly + 4, lane.name, 9.5));
        lane.bars.forEach(([a, c], k) => {
          inputs.push(
            rect(ax + a * aw, ly + 3, Math.max(4, (c - a) * aw), laneH - 8, {
              backgroundColor: ["#a5d8ff", "#b2f2bb", "#ffec99", "#ffc9c9"][
                k % 4
              ],
              strokeColor: "#495057",
            }),
          );
        });
      });
      h += lanes.length * laneH;
      // axis with marks
      const axisY = y + h + (b.marks?.length ? 24 * s : 8);
      inputs.push({
        type: "arrow",
        id: newId(),
        x: X(ax),
        y: Y(axisY),
        points: [
          [0, 0],
          [aw, 0],
        ],
        strokeWidth: 1,
        roughness: 0,
        endArrowhead: "arrow",
      });
      (b.marks ?? []).forEach((mk, i) => {
        const mx = ax + mk.at * aw;
        inputs.push({
          type: "line",
          id: newId(),
          x: X(mx),
          y: Y(axisY - 5),
          points: [
            [0, 0],
            [0, 10],
          ],
          strokeWidth: 1,
          roughness: 0,
        });
        const lw = mk.label.length * 9.5 * s * W;
        const above = i % 2 === 0;
        inputs.push(
          T(
            Math.min(Math.max(mx - lw / 2, x), x + w - lw),
            above ? axisY - 20 * s : axisY + 8,
            mk.label,
            9.5,
            { strokeColor: "#1971c2" },
          ),
        );
      });
      inputs.push(
        T(ax, axisY + (b.marks?.length ? 22 * s : 6), b.axis_start, 9.5, {
          strokeColor: "#868e96",
        }),
      );
      inputs.push(
        T(
          ax + aw - b.axis_end.length * 9.5 * s * W,
          axisY + (b.marks?.length ? 22 * s : 6),
          b.axis_end,
          9.5,
          { strokeColor: "#868e96" },
        ),
      );
      h = axisY - y + (b.marks?.length ? 36 * s : 20 * s);
      if (b.caption) {
        const lines = wrap(b.caption, w, 9 * s);
        inputs.push(
          T(x, y + h, lines.join("\n"), 9, { strokeColor: "#495057" }),
        );
        h += lines.length * 9 * s * 1.25 + 4;
      }
      return { inputs, h: h + 8 };
    },
    pipeline(b, x, y, w) {
      const inputs = [];
      let h = heading(x, y, b.heading, inputs);
      const n = b.stages.length;
      const gap = 24;
      const sw = (w - (n - 1) * gap) / n;
      const fs = 9.5 * s;
      const labels = b.stages.map((st) => wrap(st.label, sw - 10, fs));
      const sh = Math.max(
        34,
        Math.max(...labels.map((l) => l.length)) * fs * 1.25 + 12,
      );
      const ids = b.stages.map(() => newId());
      b.stages.forEach((st, i) => {
        const sx = x + i * (sw + gap);
        inputs.push(
          rect(sx, y + h, sw, sh, {
            id: ids[i],
            backgroundColor:
              i === 0 ? "#e7f5ff" : i === n - 1 ? "#d3f9d8" : "#e6fcf5",
            label: { text: labels[i].join("\n"), fontSize: fs },
          }),
        );
        if (st.note) {
          inputs.push(
            T(sx, y + h + sh + 4, wrap(st.note, sw, 9 * s).join("\n"), 9, {
              strokeColor: "#495057",
            }),
          );
        }
      });
      ids.slice(0, -1).forEach((id, i) => inputs.push(arrow(id, ids[i + 1])));
      const notesH = Math.max(
        0,
        ...b.stages.map((st) =>
          st.note ? wrap(st.note, sw, 9 * s).length * 9 * s * 1.25 + 6 : 0,
        ),
      );
      h += sh + notesH + 6;
      if (b.branch) {
        const from = b.branch.from;
        const bx = x + from * (sw + gap);
        const bid = newId();
        const by = y + h + 22;
        const lines = wrap(b.branch.target, Math.max(sw, 150) - 10, fs);
        const bh = lines.length * fs * 1.25 + 12;
        inputs.push(
          rect(bx, by, Math.max(sw, 150), bh, {
            id: bid,
            backgroundColor: "#fff5f5",
            strokeColor: "#e03131",
            label: { text: lines.join("\n"), fontSize: fs },
          }),
        );
        inputs.push({
          ...arrow(ids[from], bid),
          strokeStyle: "dashed",
          strokeColor: "#e03131",
        });
        inputs.push(
          T(bx + sw / 2 + 6, y + h + 4, b.branch.label, 9, {
            strokeColor: "#e03131",
          }),
        );
        h = by - y + bh + 6;
      }
      return { inputs, h: h + 8 };
    },
    decision_tree(b, x, y, w) {
      const inputs = [];
      const h = heading(x, y, b.heading, inputs);
      // levels by BFS from the first node
      const level = new Map([[b.nodes[0].id, 0]]);
      const queue = [b.nodes[0].id];
      while (queue.length) {
        const cur = queue.shift();
        for (const e of b.edges.filter((ed) => ed.from === cur)) {
          if (!level.has(e.to)) {
            level.set(e.to, level.get(cur) + 1);
            queue.push(e.to);
          }
        }
      }
      for (const nd of b.nodes) {
        if (!level.has(nd.id)) {
          level.set(nd.id, Math.max(...level.values()) + 1);
        }
      }
      const depth = Math.max(...level.values()) + 1;
      const bs = s; // block scale, fixed for the loop below
      const rowH = 64 * bs;
      const ids = new Map();
      const pos = new Map();
      for (let lv = 0; lv < depth; lv++) {
        const row = b.nodes.filter((nd) => level.get(nd.id) === lv);
        row.forEach((nd, i) => {
          const isDec = nd.kind === "decision";
          const nw = isDec ? 132 : 128;
          const lines = wrap(nd.label, nw - (isDec ? 34 : 12), 9 * bs);
          const nh = isDec
            ? Math.max(44, lines.length * 9.4 * bs + 22)
            : Math.max(28, lines.length * 9.4 * bs + 10);
          const cx = x + ((i + 0.5) * w) / row.length;
          const ny = y + h + lv * rowH;
          const id = newId();
          ids.set(nd.id, id);
          pos.set(nd.id, { cx, ny, nh });
          const fill =
            {
              start: "#e7f5ff",
              decision: "#fff3bf",
              action: "#e6fcf5",
              end: "#d3f9d8",
            }[nd.kind] ?? "#e6fcf5";
          inputs.push({
            type: isDec ? "diamond" : "rectangle",
            id,
            x: X(cx - nw / 2),
            y: Y(ny),
            width: nw,
            height: nh,
            backgroundColor: fill,
            strokeWidth: 1,
            roughness: 0,
            label: { text: lines.join("\n"), fontSize: 9 * bs },
          });
        });
      }
      const edgeLabels = [];
      for (const e of b.edges) {
        if (!ids.has(e.from) || !ids.has(e.to)) {
          throw new Error(
            `decision tree edge ${e.from} -> ${e.to} uses an unknown node`,
          );
        }
        inputs.push(arrow(ids.get(e.from), ids.get(e.to)));
        if (e.label) {
          const a = pos.get(e.from);
          const c = pos.get(e.to);
          edgeLabels.push(
            T((a.cx + c.cx) / 2 + 4, (a.ny + a.nh + c.ny) / 2 - 6, e.label, 9, {
              strokeColor: "#495057",
            }),
          );
        }
      }
      inputs.push(...edgeLabels);
      const last = Math.max(...[...pos.values()].map((p) => p.ny + p.nh));
      return { inputs, h: last - y + 10 };
    },
    pairs(b, x, y, w) {
      const inputs = [];
      let h = heading(x, y, b.heading, inputs);
      const cw = (w - 30) / 2;
      const fs = 9.5 * s;
      inputs.push(T(x, y + h, b.left_title, 9, { strokeColor: "#1971c2" }));
      inputs.push(
        T(x + cw + 30, y + h, b.right_title, 9, { strokeColor: "#1971c2" }),
      );
      h += 16 * s;
      for (const [a, c] of b.pairs) {
        const la = wrap(a, cw - 10, fs);
        const lc = wrap(c, cw - 10, fs);
        const rh = Math.max(la.length, lc.length) * fs * 1.25 + 10;
        inputs.push(
          rect(x, y + h, cw, rh, {
            backgroundColor: "#e7f5ff",
            label: { text: la.join("\n"), fontSize: fs },
          }),
        );
        inputs.push(T(x + cw + 9, y + h + rh / 2 - 7, "↔", 11));
        inputs.push(
          rect(x + cw + 30, y + h, cw, rh, {
            backgroundColor: "#d3f9d8",
            label: { text: lc.join("\n"), fontSize: fs },
          }),
        );
        h += rh + 5;
      }
      return { inputs, h: h + 6 };
    },
    cluster(b, x, y, w) {
      const inputs = [];
      let h = heading(x, y, b.heading, inputs);
      const topId = newId();
      const tw = Math.min(220, w * 0.5);
      inputs.push(
        rect(x + w / 2 - tw / 2, y + h, tw, 32 * s, {
          id: topId,
          backgroundColor: "#e7f5ff",
          label: { text: b.top, fontSize: 9.5 * s },
        }),
      );
      const n = b.workers.length;
      const ww = (w - (n - 1) * 12) / n;
      const wy = y + h + 32 * s + 34;
      const bodyLines = b.workers.map((wk) =>
        wk.items.flatMap((it) => wrap(`• ${it}`, ww - 12, 9.5 * s)),
      );
      const wh =
        22 * s +
        Math.max(...bodyLines.map((l) => l.length)) * 9.5 * s * 1.25 +
        10;
      b.workers.forEach((wk, i) => {
        const wx = x + i * (ww + 12);
        const id = newId();
        inputs.push(rect(wx, wy, ww, wh, { id, backgroundColor: "#e6fcf5" }));
        inputs.push(T(wx + 6, wy + 5, wk.title, 9, { _font: EXCALIFONT }));
        inputs.push(T(wx + 6, wy + 22 * s, bodyLines[i].join("\n"), 9.5));
        inputs.push(arrow(topId, id));
      });
      h = wy - y + wh + 6;
      if (b.caption) {
        const lines = wrap(b.caption, w, 9 * s);
        inputs.push(
          T(x, y + h, lines.join("\n"), 9, { strokeColor: "#495057" }),
        );
        h += lines.length * 9 * s * 1.25 + 4;
      }
      return { inputs, h: h + 8 };
    },
    flowchart(b, x, y, w) {
      const inputs = [];
      const h = heading(x, y, b.heading, inputs);
      const fh = (b.height ?? 200) * s;
      const groups = b.groups;
      const gap = 16;
      const fw = (w - gap * (groups.length - 1)) / groups.length;
      const nodeId = new Map();
      const centers = new Map();
      groups.forEach((grp, gi) => {
        const fx = x + gi * (fw + gap);
        inputs.push(
          rect(fx, y + h, fw, fh, {
            backgroundColor: "transparent",
            strokeColor: "#adb5bd",
            strokeStyle: "dashed",
          }),
        );
        inputs.push(
          T(
            fx + fw / 2 - (grp.title.length * 9.5 * s * W) / 2,
            y + h + 4,
            grp.title,
            9.5,
            { strokeColor: "#495057" },
          ),
        );
        grp.nodes.forEach((nd, ni) => {
          const id = newId();
          nodeId.set(nd.id, id);
          const lines = wrap(nd.label, fw - 18, 9 * s);
          const nh = Math.max(28, lines.length * 9.4 * s + 8);
          const ny =
            y + h + 18 + ((ni + 0.5) * (fh - 22)) / grp.nodes.length - nh / 2;
          centers.set(nd.id, { cx: fx + fw / 2, cy: ny + nh / 2 });
          inputs.push(
            rect(fx + 8, ny, fw - 16, nh, {
              id,
              backgroundColor: "#e6fcf5",
              label: { text: lines.join("\n"), fontSize: 9 * s },
            }),
          );
        });
      });
      for (const e of b.edges) {
        inputs.push(arrow(nodeId.get(e.from), nodeId.get(e.to)));
        const a = centers.get(e.from);
        const c = centers.get(e.to);
        const lw = e.label.length * 8.5 * s * W;
        const horizontal = Math.abs(c.cx - a.cx) >= Math.abs(c.cy - a.cy);
        const mx = (a.cx + c.cx) / 2;
        const my = (a.cy + c.cy) / 2;
        inputs.push(
          horizontal
            ? T(mx - lw / 2, my - 12, e.label, 8.5)
            : T(mx + 4, my - 4, e.label, 8.5),
        );
      }
      return { inputs, h: h + fh + 8 };
    },
    table(b, x, y, w) {
      const inputs = [];
      let h = b.heading ? heading(x, y, b.heading, inputs) : 0;
      const rows = [b.columns, ...b.rows];
      const fs = 8.5 * s;
      const longest = rows[0].map((_, c) =>
        Math.max(...rows.map((r) => (r[c] ?? "").length)),
      );
      // natural width per column (long cells wrap at half the column width);
      // shrink proportionally only if the table would be wider than the column
      const natural = longest.map((l) =>
        Math.min(l * fs * W + PAD * 2 + 6, w * 0.5),
      );
      const naturalSum = natural.reduce((a, c) => a + c, 0);
      const widths =
        naturalSum > w ? natural.map((n) => (n / naturalSum) * w) : natural;
      const fix = [];
      rows.forEach((r, ri) => {
        const wrapped = r.map((cell, c) => wrap(cell, widths[c] - PAD * 2, fs));
        const rh =
          Math.max(...wrapped.map((l) => l.length)) * fs * 1.25 + PAD * 2 + 2;
        let cx = x;
        r.forEach((cell, c) => {
          const id = newId();
          inputs.push(
            rect(cx, y + h, widths[c], rh, {
              id,
              backgroundColor: ri === 0 ? "#e7f5ff" : "#ffffff",
              strokeColor: "#ced4da",
              label: {
                text: wrapped[c].join("\n"),
                fontSize: fs,
                strokeColor: ri === 0 ? "#1971c2" : "#1e1e1e",
              },
            }),
          );
          fix.push({ id, original: cell, lines: wrapped[c].length });
          cx += widths[c];
        });
        h += rh;
      });
      return { inputs, h: h + 10, cells: fix };
    },
    decisions(b, x, y, w) {
      return B.table(
        {
          heading: b.heading ?? "Comparisons & Decision Guide",
          columns: ["If the scenario says...", "Choose...", "Because..."],
          rows: b.rows,
        },
        x,
        y,
        w,
      );
    },
    tips(b, x, y, w) {
      const inputs = [];
      const h = heading(x, y, b.heading ?? "Exam Tips & Traps", inputs);
      // tips are large: their size is chosen to fill the left column
      const lines = b.items.flatMap((t, i) =>
        wrap(`${i + 1}. ${t}`, w - 20, tipsFs).map((l, k) =>
          k ? `    ${l}` : l,
        ),
      );
      inputs.push({
        ...T(x + 18, y + h, lines.join("\n"), 1),
        fontSize: tipsFs,
      });
      return { inputs, h: h + lines.length * tipsFs * 1.25 + 8 };
    },
  };

  for (const b of spec.blocks) {
    s = scaleOf(b.col);
    const [x1, x2] = COLS[b.col];
    const y =
      b.col === "middle-right"
        ? Math.max(cursor.middle, cursor.right)
        : cursor[b.col];
    const built = B[b.type](b, x1, y, x2 - x1);
    blocks.push({
      inputs: built.inputs,
      cells: built.cells ?? [],
      col: b.col,
      y,
      h: built.h,
    });
    const next = y + built.h + 6;
    if (b.col === "middle-right") {
      cursor.middle = next;
      cursor.right = next;
    } else {
      cursor[b.col] = next;
    }
  }
  return {
    blocks,
    bottom: Math.max(cursor.left, cursor.middle, cursor.right),
    leftBottom: cursor.left,
    cols: { ...cursor },
  };
};

/** Shares each column's leftover height as equal gaps between its blocks. */
const spreadColumns = (plan) => {
  const shift = new Map(plan.blocks.map((b) => [b, null]));
  for (const col of ["left", "middle", "right"]) {
    const inCol = plan.blocks
      .filter(
        (b) => b.col === col || (b.col === "middle-right" && col !== "left"),
      )
      .sort((a, b) => a.y - b.y);
    if (inCol.length < 2) {
      continue;
    }
    const last = inCol.at(-1);
    const leftover = BOTTOM - (last.y + last.h);
    const gap = Math.max(0, Math.min(MAX_GAP, leftover / (inCol.length - 1)));
    inCol.forEach((b, i) => {
      const dy = i * gap;
      shift.set(b, shift.get(b) === null ? dy : Math.min(shift.get(b), dy));
    });
  }
  for (const [b, dy] of shift) {
    if (!dy) {
      continue;
    }
    for (const input of b.inputs) {
      if (typeof input.y === "number") {
        input.y += dy;
      }
    }
  }
};

export const renderBlocks = (scene, row, spec) => {
  const live = scene.elements.filter((e) => !e.isDeleted);
  const box = live
    .filter(
      (e) =>
        e.type === "rectangle" &&
        e.backgroundColor.toLowerCase() === "#fff4e6" &&
        e.width > 1000 &&
        !e.id.startsWith("legend-"),
    )
    .sort((a, b) => a.y - b.y)[row - 1];
  const g = box?.groupIds?.at(-1);
  if (!g) {
    throw new Error(`material ${row} missing or not grouped`);
  }
  const members = live.filter((e) => (e.groupIds ?? []).includes(g));
  const isTitle = (e) =>
    e.type === "text" && e.y < box.y && /^\d+\. /.test(e.text);
  // service chips only: violet "↗" boxes linking to a section, their labels, "Services:"
  const chipBoxes = new Set(
    members
      .filter(
        (e) =>
          e.type === "rectangle" &&
          e.backgroundColor.toLowerCase() === "#f3f0ff" &&
          (e.link ?? "").includes("?element="),
      )
      .map((e) => e.id),
  );
  // a chip's label, matched both ways: the browser renames boxes on save
  // without updating their labels' containerId
  const chipLabels = new Set(
    members
      .filter((e) => chipBoxes.has(e.id))
      .flatMap((e) => (e.boundElements ?? []).map((b) => b.id)),
  );
  const isChip = (e) =>
    chipBoxes.has(e.id) ||
    (e.type === "text" &&
      (chipBoxes.has(e.containerId) ||
        chipLabels.has(e.id) ||
        e.text === "Services:"));
  if (
    !spec.replace_existing &&
    !members.some((e) => e.type === "text" && e.text.trim() === "- Template")
  ) {
    throw new Error(
      `material ${row} has no template left; set replace_existing to redesign it`,
    );
  }
  // fit: scale text down until every column ends above the box bottom
  let s = 1;
  let plan;
  for (s = 1.3; s >= 0.78; s -= 0.04) {
    plan = layout(box, spec, s, 12 * s);
    if (plan.bottom <= BOTTOM) {
      break;
    }
  }
  // tips as large as the left column allows (12-16 px)
  let tipsFs = 12 * s;
  for (let t = 16; t > 12 * s; t -= 0.5) {
    const trial = layout(box, spec, s, t);
    if (trial.bottom <= BOTTOM && trial.leftBottom <= BOTTOM) {
      plan = trial;
      tipsFs = t;
      break;
    }
  }
  // sparse middle/right columns grow their text before gaps fill the rest
  const sc = { left: s, middle: s, right: s };
  if (plan.bottom <= BOTTOM) {
    for (const col of ["middle", "right"]) {
      for (let g = MAX_COL_SCALE; g > sc[col] + 0.001; g -= 0.02) {
        const trial = layout(box, spec, { ...sc, [col]: g }, tipsFs);
        if (trial.bottom <= BOTTOM) {
          sc[col] = g;
          plan = trial;
          break;
        }
      }
    }
  }
  if (plan.bottom <= BOTTOM) {
    spreadColumns(plan);
  }
  if (plan.bottom > BOTTOM) {
    throw new Error(
      `material ${row} doesn't fit (bottom ${Math.round(
        plan.bottom,
      )}); shorten the spec`,
    );
  }
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
  let added = 0;
  for (const blk of plan.blocks) {
    const start = scene.elements.length;
    const fonts = new Map(
      blk.inputs.filter((i) => i._font).map((i) => [i.id, i._font]),
    );
    addElements(
      scene.elements,
      blk.inputs.map((input) => {
        const rest = { ...input };
        delete rest._font;
        return rest;
      }),
    );
    const fresh = scene.elements.slice(start);
    const inner = newId();
    const cells = new Map(blk.cells.map((c) => [c.id, c]));
    for (const e of fresh) {
      e.groupIds = [inner, g];
      if (e.type === "text") {
        e.fontFamily = fonts.get(e.id) ?? NUNITO;
        if (!e.containerId) {
          const perChar = e.fontFamily === EXCALIFONT ? 0.66 : 0.6;
          e.width =
            Math.max(...e.text.split("\n").map((l) => l.length)) *
            e.fontSize *
            perChar;
        }
      }
      if (cells.has(e.id)) {
        e.roundness = null;
      }
    }
    for (const [id, c] of cells) {
      const cell = fresh.find((e) => e.id === id);
      const label = fresh.find((e) => e.containerId === id);
      label.textAlign = "left";
      label.verticalAlign = "top";
      label.originalText = c.original;
      label.width = cell.width - PAD * 2;
      label.height = c.lines * label.fontSize * 1.25;
      label.x = cell.x + PAD;
      label.y = cell.y + PAD + 1;
    }
    added += fresh.length;
  }
  return {
    row,
    scale: Object.fromEntries(
      Object.entries(sc).map(([k, v]) => [k, Math.round(v * 100) / 100]),
    ),
    tips_font: tipsFs,
    removed,
    added,
    bottom: Math.round(plan.bottom),
  };
};

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const [target, specsDir, rowsArg] = process.argv.slice(2);
  const rows = rowsArg.split(",").map(Number);
  const files = readdirSync(specsDir).filter((f) => /^\d+-.+\.json$/.test(f));
  const specFor = (r) =>
    JSON.parse(
      readFileSync(
        join(
          specsDir,
          files.find((f) => Number(f.split("-")[0]) === r),
        ),
        "utf8",
      ),
    );
  const run = (scene) => rows.map((r) => renderBlocks(scene, r, specFor(r)));
  const dryIdx = process.argv.indexOf("--dry-run");
  if (dryIdx > 0) {
    const scene = JSON.parse(
      readFileSync(`${process.env.HOME}/drawings/${target}.excalidraw`, "utf8"),
    );
    console.log(run(scene));
    if (process.argv[dryIdx + 1]) {
      writeFileSync(process.argv[dryIdx + 1], JSON.stringify(scene));
    }
  } else {
    console.log(
      await createClient("http://localhost:3000").modify(target, run),
    );
  }
}
