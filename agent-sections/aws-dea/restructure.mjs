/* eslint-disable no-console -- CLI script that reports to stdout */
// Lays out aws-data-engineer-associate by the rules in ../HIERARCHY.md:
// one row per lesson (cert.yaml order), the tree re-spaced so each lesson
// sits level with its material, one material per lesson (copies of Thomas's
// template, titled), services in their lesson's row, and a legend.
// Usage: node restructure.mjs [--dry-run <out.excalidraw>]
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const HERE = import.meta.dirname;
const M = resolve(HERE, "../../mcp-server");
const { createClient } = await import(join(M, "client.mjs"));
const { addElements, updateElements } = await import(join(M, "elements.mjs"));

const TARGET = "aws-data-engineer-associate";
const dryIdx = process.argv.indexOf("--dry-run");
const dryOut = dryIdx > 0 ? process.argv[dryIdx + 1] : null;

const curriculum = JSON.parse(
  readFileSync(join(HERE, "curriculum.json"), "utf8"),
);
const lessonServices = JSON.parse(
  readFileSync(join(HERE, "lesson-services.json"), "utf8"),
);
const lessons = curriculum.phases.flatMap((p) =>
  p.modules.flatMap((m) => m.lessons),
);

const FILL = {
  yellow: "#ffec99",
  blue: "#a5d8ff",
  green: "#b2f2bb",
  teal: "#96f2d7",
  orange: "#fff4e6",
  violet: "#f3f0ff",
};
const ROW0 = -10948; // top of the first material
const STEP = 725; // material height 589 + gap
const MAT = { x: 3838, w: 1609, h: 589 };
const SVC_X0 = MAT.x + MAT.w + 90;
const SVC_STEP = 750;
const rowTop = (i) => ROW0 + i * STEP;
const rowMid = (i) => rowTop(i) + MAT.h / 2;
const newId = () => randomBytes(10).toString("base64url");

const restructure = (scene) => {
  const els = scene.elements;
  const live = () => els.filter((e) => !e.isDeleted);
  const byId = new Map(live().map((e) => [e.id, e]));
  if (live().some((e) => e.id === "legend-title")) {
    throw new Error("already restructured");
  }
  const labelOf = (e) =>
    (e.boundElements ?? [])
      .map((b) => byId.get(b.id))
      .find((t) => t?.type === "text")?.text ?? "";
  const boxes = (fill, pred) =>
    live()
      .filter(
        (e) =>
          e.type === "rectangle" &&
          e.backgroundColor.toLowerCase() === fill &&
          pred(e),
      )
      .sort((a, b) => a.y - b.y);
  const groupMembers = (g) =>
    live().filter((e) => (e.groupIds ?? []).includes(g));
  const shift = (members, dx, dy) => {
    for (const e of members) {
      e.x += dx;
      e.y += dy;
      e.version = (e.version ?? 1) + 1;
      e.updated = Date.now();
    }
  };

  // --- tree -------------------------------------------------------------
  const tree = {
    yellow: boxes(FILL.yellow, (e) => e.x < 0 && e.width > 1000),
    blue: boxes(FILL.blue, (e) => e.x < 3000 && e.width > 1000),
    green: boxes(FILL.green, (e) => e.x < 3000 && e.width > 700),
    teal: boxes(FILL.teal, (e) => e.x < 3000 && e.width > 700),
  };
  const nMods = curriculum.phases.reduce((n, p) => n + p.modules.length, 0);
  if (
    tree.yellow.length !== 1 ||
    tree.blue.length !== curriculum.phases.length ||
    tree.green.length !== nMods ||
    tree.teal.length !== lessons.length
  ) {
    throw new Error(
      `tree mismatch: ${JSON.stringify(
        Object.fromEntries(Object.entries(tree).map(([k, v]) => [k, v.length])),
      )}`,
    );
  }
  const moves = []; // {id, y}
  const centreY = {};
  tree.teal.forEach((e, i) => {
    centreY[e.id] = rowMid(i);
  });
  let li = 0;
  let mi = 0;
  const blueCentres = [];
  curriculum.phases.forEach((p, pi) => {
    const modCentres = [];
    for (const m of p.modules) {
      const ys = m.lessons.map(() => rowMid(li++));
      const c = (ys[0] + ys[ys.length - 1]) / 2;
      centreY[tree.green[mi++].id] = c;
      modCentres.push(c);
    }
    const c = (modCentres[0] + modCentres[modCentres.length - 1]) / 2;
    centreY[tree.blue[pi].id] = c;
    blueCentres.push(c);
  });
  const yellow = tree.yellow[0];
  centreY[yellow.id] =
    (blueCentres[0] + blueCentres[blueCentres.length - 1]) / 2;
  const yellowDy = centreY[yellow.id] - (yellow.y + yellow.height / 2);
  for (const [id, cy] of Object.entries(centreY)) {
    const e = byId.get(id);
    moves.push({ id, y: Math.round(cy - e.height / 2) });
  }
  // exam facts text and badge image next to the title move with it
  const titleExtras = live().filter(
    (e) =>
      e.x < -4000 &&
      e !== yellow &&
      !e.containerId &&
      e.type !== "arrow" &&
      !(
        e.backgroundColor?.toLowerCase() === FILL.yellow &&
        e.type === "rectangle"
      ),
  );
  shift(titleExtras, 0, yellowDy);
  updateElements(els, moves); // re-routes the attached tree arrows

  // --- materials ---------------------------------------------------------
  const mats = boxes(FILL.orange, (e) => e.width > 1000);
  const templateBox = mats.find(
    (b) =>
      groupMembers(b.groupIds.at(-1)).some(
        (e) => e.type === "text" && e.text.trim() === "- Template",
      ) &&
      groupMembers(b.groupIds.at(-1)).filter(
        (e) => e.type === "text" && e.text.trim() === "- Template",
      ).length >= 7,
  );
  if (!templateBox) {
    throw new Error("template not found");
  }
  const templateEls = structuredClone(
    groupMembers(templateBox.groupIds.at(-1)),
  );
  const tplOrigin = { x: templateBox.x, y: templateBox.y };
  const matBoxes = [];
  mats.forEach((b, i) => {
    shift(groupMembers(b.groupIds.at(-1)), MAT.x - b.x, rowTop(i) - b.y);
    matBoxes.push(b);
  });
  for (let i = mats.length; i < lessons.length; i++) {
    const ids = new Map(templateEls.map((e) => [e.id, newId()]));
    const groups = new Map();
    const g = (id) => groups.get(id) ?? groups.set(id, newId()).get(id);
    const copy = templateEls.map((src) => {
      const e = structuredClone(src);
      e.id = ids.get(src.id);
      e.x = src.x - tplOrigin.x + MAT.x;
      e.y = src.y - tplOrigin.y + rowTop(i);
      e.index = null;
      e.version = 1;
      e.versionNonce = Math.floor(Math.random() * 2 ** 31);
      e.updated = Date.now();
      e.groupIds = (src.groupIds ?? []).map(g);
      if (e.containerId) {
        e.containerId = ids.get(e.containerId) ?? e.containerId;
      }
      if (e.boundElements) {
        e.boundElements = e.boundElements.map((b) => ({
          ...b,
          id: ids.get(b.id) ?? b.id,
        }));
      }
      for (const k of ["startBinding", "endBinding"]) {
        if (e[k]) {
          e[k] = {
            ...e[k],
            elementId: ids.get(e[k].elementId) ?? e[k].elementId,
          };
        }
      }
      return e;
    });
    els.push(...copy);
    matBoxes.push(copy.find((e) => e.id === ids.get(templateBox.id)));
  }
  // title line above each material, in the material's group
  const titles = [];
  addElements(
    titles,
    lessons.map((l, i) => ({
      type: "text",
      id: `mat-title-${i + 1}`,
      x: MAT.x,
      y: rowTop(i) - 44,
      text: `${i + 1}. ${l.title}`,
      fontSize: 24,
    })),
  );
  titles.forEach((t, i) => {
    t.groupIds = [matBoxes[i].groupIds.at(-1)];
  });
  els.push(...titles);

  // lesson -> material arrows
  addElements(
    els,
    tree.teal.map((t, i) => ({
      type: "arrow",
      id: `lesson-mat-${i + 1}`,
      start: { id: t.id },
      end: { id: matBoxes[i].id },
      strokeWidth: 2,
      roughness: 1,
    })),
  );

  // --- services ------------------------------------------------------------
  const sectionByTitle = new Map();
  for (const b of boxes(FILL.violet, (e) => e.width > 600)) {
    const g = b.groupIds.at(-1);
    const head = groupMembers(g)
      .filter(
        (e) => e.type === "text" && !e.containerId && e.text.startsWith("- "),
      )
      .sort((a, c) => a.y - c.y || a.x - c.x)[0];
    sectionByTitle.set(head.text.slice(2).trim(), b);
  }
  let placed = 0;
  lessons.forEach((l, i) => {
    (lessonServices[l.id] ?? []).forEach((title, k) => {
      const b = sectionByTitle.get(title);
      if (!b) {
        throw new Error(`service section not found: ${title}`);
      }
      shift(
        groupMembers(b.groupIds.at(-1)),
        SVC_X0 + k * SVC_STEP - b.x,
        rowTop(i) - b.y,
      );
      placed++;
    });
  });
  if (placed !== sectionByTitle.size) {
    throw new Error(`placed ${placed} of ${sectionByTitle.size} services`);
  }

  // old column headings no longer apply
  for (const e of live()) {
    if (e.id.startsWith("svc-heading-")) {
      e.isDeleted = true;
    }
  }

  // --- legend --------------------------------------------------------------
  const LX = yellow.x;
  const LY = rowTop(lessons.length) + 300;
  const items = [
    ["Certification", FILL.yellow],
    ["Learning path", FILL.blue],
    ["Module", FILL.green],
    ["Lesson", FILL.teal],
    ["Material (my notes)", FILL.orange],
    ["AWS service", FILL.violet],
  ];
  const legend = [];
  addElements(legend, [
    {
      type: "text",
      id: "legend-title",
      x: LX,
      y: LY,
      text: "Legend: left to right = exam → details, top to bottom = study order",
      fontSize: 36,
    },
    ...items.map(([text, fill], k) => ({
      type: "rectangle",
      id: `legend-${k + 1}`,
      x: LX + k * 420,
      y: LY + 70,
      width: 380,
      height: 90,
      backgroundColor: fill,
      strokeWidth: 2,
      roughness: 1,
      label: { text, fontSize: 28 },
    })),
  ]);
  const lg = newId();
  for (const e of legend) {
    e.groupIds = [lg];
  }
  els.push(...legend);

  return {
    lessons: lessons.length,
    materials_new: lessons.length - mats.length,
    services_placed: placed,
    tree_moved: moves.length,
    legend_y: LY,
  };
};

if (dryOut) {
  const scene = JSON.parse(
    readFileSync(`${process.env.HOME}/drawings/${TARGET}.excalidraw`, "utf8"),
  );
  console.log(restructure(scene));
  writeFileSync(dryOut, JSON.stringify(scene));
} else {
  console.log(
    await createClient("http://localhost:3000").modify(TARGET, restructure),
  );
}
