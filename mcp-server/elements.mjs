/**
 * Converts between the compact element format agents write (shapes with a
 * `label`, arrows with `start`/`end`) and full Excalidraw elements, and
 * applies edits to a scene. Pure functions: no I/O.
 *
 * The compact format follows the official excalidraw-mcp "skeleton" format
 * (MIT), so models that know it can use this server the same way.
 */
import { randomBytes, randomInt } from "node:crypto";

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const LINEAR = new Set(["arrow", "line"]);
const SUPPORTED = new Set([...SHAPES, ...LINEAR, "text"]);

const DEFAULT_FONT_SIZE = 20;
const LABEL_FONT_SIZE = 20;
const LINE_HEIGHT = 1.25;
/** Excalifont, the hand-drawn default. */
const DEFAULT_FONT_FAMILY = 5;
/** Space between an arrow tip and the shape it points at. */
const ARROW_GAP = 8;

/** Style props an agent may set on any element. */
const STYLE_KEYS = [
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
  "angle",
  "roundness",
  "groupIds",
  "link",
  "locked",
];

export class ElementError extends Error {}

export const newId = () => randomBytes(10).toString("base64url");
const seed = () => randomInt(1, 2 ** 31 - 1);

const round = (n) => Math.round(n * 100) / 100;

/** Rough text box size; the editor re-measures when it renders. */
export const measureText = (text, fontSize) => {
  const lines = String(text).split("\n");
  const longest = Math.max(...lines.map((l) => l.length), 1);
  return {
    width: round(longest * fontSize * 0.55),
    height: round(lines.length * fontSize * LINE_HEIGHT),
  };
};

const base = (el) => ({
  id: el.id,
  type: el.type,
  x: el.x ?? 0,
  y: el.y ?? 0,
  width: el.width ?? 0,
  height: el.height ?? 0,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  seed: seed(),
  version: 1,
  versionNonce: seed(),
  isDeleted: false,
  boundElements: null,
  updated: Date.now(),
  link: null,
  locked: false,
  ...pick(el, STYLE_KEYS),
});

const pick = (obj, keys) =>
  Object.fromEntries(
    keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]),
  );

const textElement = ({ id, text, fontSize, x, y, containerId, extra }) => {
  const size = measureText(text, fontSize);
  return {
    ...base({ id, type: "text", x, y, ...size }),
    ...extra,
    text,
    originalText: text,
    fontSize,
    fontFamily: DEFAULT_FONT_FAMILY,
    textAlign: containerId ? "center" : extra?.textAlign ?? "left",
    verticalAlign: containerId ? "middle" : extra?.verticalAlign ?? "top",
    containerId: containerId ?? null,
    autoResize: true,
    lineHeight: LINE_HEIGHT,
  };
};

const addBound = (el, ref) => {
  const list = (el.boundElements ?? []).filter((b) => b.id !== ref.id);
  el.boundElements = [...list, ref];
};

const removeBound = (el, id) => {
  if (el.boundElements) {
    const list = el.boundElements.filter((b) => b.id !== id);
    el.boundElements = list.length ? list : null;
  }
};

const touch = (el) => {
  el.version = (el.version ?? 1) + 1;
  el.versionNonce = seed();
  el.updated = Date.now();
};

const center = (el) => ({ x: el.x + el.width / 2, y: el.y + el.height / 2 });

/** Where the line from `el`'s centre towards `toward` leaves its box. */
const edgePoint = (el, toward, gap) => {
  const c = center(el);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) {
    return c;
  }
  const halfW = el.width / 2 + gap;
  const halfH = el.height / 2 + gap;
  const scale = 1 / Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
};

const fixedPointOf = (el, point) => [
  Math.min(1, Math.max(0, (point.x - el.x) / (el.width || 1))),
  Math.min(1, Math.max(0, (point.y - el.y) / (el.height || 1))),
];

/**
 * Re-draws an arrow/line as a straight segment between the shapes it's bound
 * to (a free end keeps its position) and refreshes its bindings and label.
 */
const routeLinear = (arrow, byId) => {
  const points = arrow.points?.length
    ? arrow.points
    : [
        [0, 0],
        [arrow.width, arrow.height],
      ];
  let from = { x: arrow.x + points[0][0], y: arrow.y + points[0][1] };
  let to = {
    x: arrow.x + points[points.length - 1][0],
    y: arrow.y + points[points.length - 1][1],
  };
  const startEl = byId.get(arrow.startBinding?.elementId);
  const endEl = byId.get(arrow.endBinding?.elementId);
  if (!startEl && !endEl) {
    return;
  }
  const startAim = endEl ? center(endEl) : to;
  const endAim = startEl ? center(startEl) : from;
  if (startEl) {
    from = edgePoint(startEl, startAim, ARROW_GAP);
    arrow.startBinding = {
      elementId: startEl.id,
      mode: "orbit",
      fixedPoint: fixedPointOf(startEl, from),
    };
  }
  if (endEl) {
    to = edgePoint(endEl, endAim, ARROW_GAP);
    arrow.endBinding = {
      elementId: endEl.id,
      mode: "orbit",
      fixedPoint: fixedPointOf(endEl, to),
    };
  }
  arrow.x = round(from.x);
  arrow.y = round(from.y);
  arrow.points = [
    [0, 0],
    [round(to.x - from.x), round(to.y - from.y)],
  ];
  arrow.width = round(Math.abs(to.x - from.x));
  arrow.height = round(Math.abs(to.y - from.y));
};

/** Centres a container's bound label on it (arrows: on the midpoint). */
const placeLabel = (container, label) => {
  if (LINEAR.has(container.type)) {
    const last = container.points[container.points.length - 1];
    label.x = round(container.x + last[0] / 2 - label.width / 2);
    label.y = round(container.y + last[1] / 2 - label.height / 2);
  } else {
    label.x = round(container.x + (container.width - label.width) / 2);
    label.y = round(container.y + (container.height - label.height) / 2);
  }
};

const labelOf = (container, elements) =>
  elements.find((e) => e.containerId === container.id && !e.isDeleted);

/** Sets, changes or (with null) removes a container's label. */
const applyLabel = (container, label, elements) => {
  const existing = labelOf(container, elements);
  if (label === null || label?.text === "") {
    if (existing) {
      existing.isDeleted = true;
      touch(existing);
      removeBound(container, existing.id);
    }
    return;
  }
  const fontSize = label.fontSize ?? existing?.fontSize ?? LABEL_FONT_SIZE;
  if (existing) {
    Object.assign(existing, measureText(label.text, fontSize), {
      text: label.text,
      originalText: label.text,
      fontSize,
      ...pick(label, ["strokeColor"]),
    });
    touch(existing);
    placeLabel(container, existing);
    return;
  }
  const text = textElement({
    id: newId(),
    text: label.text,
    fontSize,
    containerId: container.id,
    extra: pick(label, ["strokeColor"]),
  });
  placeLabel(container, text);
  addBound(container, { id: text.id, type: "text" });
  elements.push(text);
};

const requireNumber = (el, key) => {
  if (typeof el[key] !== "number" || !Number.isFinite(el[key])) {
    throw new ElementError(
      `element ${el.id ?? "?"}: "${key}" must be a number`,
    );
  }
};

/** Builds one full element (without labels/bindings) from compact input. */
const buildElement = (input) => {
  const type = input.type;
  if (!SUPPORTED.has(type)) {
    throw new ElementError(
      `unsupported type "${type}" (use ${[...SUPPORTED].join(", ")})`,
    );
  }
  const id = input.id ?? newId();
  if (type === "text") {
    if (typeof input.text !== "string" || !input.text) {
      throw new ElementError(`text element ${id}: "text" is required`);
    }
    requireNumber(input, "x");
    requireNumber(input, "y");
    return textElement({
      id,
      text: input.text,
      fontSize: input.fontSize ?? DEFAULT_FONT_SIZE,
      x: input.x,
      y: input.y,
      extra: pick(input, [...STYLE_KEYS, "textAlign", "verticalAlign"]),
    });
  }
  if (SHAPES.has(type)) {
    for (const key of ["x", "y", "width", "height"]) {
      requireNumber(input, key);
    }
    return {
      ...base({
        roundness: type === "rectangle" ? { type: 3 } : null,
        ...input,
        id,
      }),
    };
  }
  // arrow / line: coordinates are optional when both ends are bound
  const bound = input.start?.id && input.end?.id;
  if (!bound) {
    requireNumber(input, "x");
    requireNumber(input, "y");
  }
  const points = input.points ?? [
    [0, 0],
    [input.width ?? 100, input.height ?? 0],
  ];
  const last = points[points.length - 1];
  return {
    ...base({ ...input, id }),
    width: Math.abs(last[0]),
    height: Math.abs(last[1]),
    points,
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: input.startArrowhead ?? null,
    endArrowhead:
      input.endArrowhead !== undefined
        ? input.endArrowhead
        : type === "arrow"
        ? "arrow"
        : null,
    elbowed: false,
  };
};

const bindEnd = (arrow, end, side, byId) => {
  if (!end?.id) {
    return;
  }
  const target = byId.get(end.id);
  if (!target || target.isDeleted || !SHAPES.has(target.type)) {
    throw new ElementError(
      `arrow ${arrow.id}: ${side} "${end.id}" isn't a rectangle/ellipse/diamond in this drawing`,
    );
  }
  arrow[`${side}Binding`] = { elementId: target.id, mode: "orbit" };
  addBound(target, { id: arrow.id, type: "arrow" });
};

/**
 * Adds compact elements to a scene's element list (mutates and returns it).
 * Ids must be unique; omitted ids are generated.
 */
export const addElements = (elements, inputs) => {
  const byId = new Map(
    elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]),
  );
  const added = [];
  for (const input of inputs) {
    if (input.type === "cameraUpdate" || input.type === "delete") {
      continue; // official-format pseudo elements: nothing to store
    }
    if (input.id && byId.has(input.id)) {
      throw new ElementError(`id "${input.id}" already exists`);
    }
    const el = buildElement(input);
    byId.set(el.id, el);
    elements.push(el);
    added.push({ el, input });
  }
  for (const { el, input } of added) {
    if (LINEAR.has(el.type)) {
      bindEnd(el, input.start, "start", byId);
      bindEnd(el, input.end, "end", byId);
      routeLinear(el, byId);
    }
  }
  for (const { el, input } of added) {
    if (input.label && el.type !== "text") {
      applyLabel(el, input.label, elements);
    }
  }
  return added.map(({ el }) => el.id);
};

const UPDATABLE = new Set([
  ...STYLE_KEYS,
  "x",
  "y",
  "width",
  "height",
  "text",
  "fontSize",
  "points",
  "startArrowhead",
  "endArrowhead",
  "label",
  "start",
  "end",
]);

/**
 * Applies `{ id, ...props }` updates. Moving or resizing a shape keeps its
 * label centred and re-routes arrows bound to it.
 */
export const updateElements = (elements, updates) => {
  const byId = new Map(
    elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]),
  );
  const reroute = new Set();
  for (const { id, ...props } of updates) {
    const el = byId.get(id);
    if (!el) {
      throw new ElementError(`no element with id "${id}"`);
    }
    for (const key of Object.keys(props)) {
      if (!UPDATABLE.has(key)) {
        throw new ElementError(`"${key}" can't be updated`);
      }
    }
    const { label, start, end, text, fontSize, ...plain } = props;
    Object.assign(el, plain);
    if (el.type === "text" && (text !== undefined || fontSize !== undefined)) {
      el.text = text ?? el.text;
      el.originalText = el.text;
      el.fontSize = fontSize ?? el.fontSize;
      Object.assign(el, measureText(el.text, el.fontSize));
    }
    if (LINEAR.has(el.type)) {
      if (plain.points) {
        const last = plain.points[plain.points.length - 1];
        el.width = Math.abs(last[0]);
        el.height = Math.abs(last[1]);
      }
      for (const [side, value] of [
        ["start", start],
        ["end", end],
      ]) {
        if (value === undefined) {
          continue;
        }
        const old = byId.get(el[`${side}Binding`]?.elementId);
        if (old) {
          removeBound(old, el.id);
        }
        el[`${side}Binding`] = null;
        bindEnd(el, value, side, byId);
      }
      reroute.add(el);
    }
    if (["x", "y", "width", "height"].some((k) => k in plain)) {
      for (const ref of el.boundElements ?? []) {
        const arrow = byId.get(ref.id);
        if (arrow && LINEAR.has(arrow.type)) {
          reroute.add(arrow);
        }
      }
    }
    touch(el);
    if (label !== undefined && el.type !== "text") {
      applyLabel(el, label, elements);
    } else {
      const existing = labelOf(el, elements);
      if (existing) {
        placeLabel(el, existing);
      }
    }
  }
  for (const arrow of reroute) {
    routeLinear(arrow, byId);
    touch(arrow);
    const existing = labelOf(arrow, elements);
    if (existing) {
      placeLabel(arrow, existing);
    }
  }
};

/**
 * Deletes elements by id, with their labels; arrows bound to a deleted
 * shape stay but lose that binding. Returns the ids actually removed.
 */
export const deleteElements = (elements, ids) => {
  const doomed = new Set(ids);
  for (const id of ids) {
    if (!elements.some((e) => e.id === id && !e.isDeleted)) {
      throw new ElementError(`no element with id "${id}"`);
    }
  }
  for (const el of elements) {
    if (el.containerId && doomed.has(el.containerId)) {
      doomed.add(el.id);
    }
  }
  for (const el of elements) {
    if (doomed.has(el.id)) {
      el.isDeleted = true;
      touch(el);
      continue;
    }
    for (const side of ["startBinding", "endBinding"]) {
      if (el[side] && doomed.has(el[side].elementId)) {
        el[side] = null;
        touch(el);
      }
    }
    if (el.boundElements?.some((b) => doomed.has(b.id))) {
      el.boundElements = el.boundElements.filter((b) => !doomed.has(b.id));
      if (!el.boundElements.length) {
        el.boundElements = null;
      }
      touch(el);
    }
  }
  return [...doomed];
};

/**
 * Compact view of a scene for an agent: deleted elements and bound labels
 * are folded away, default styles are left out, images show only their size.
 */
export const describeElements = (elements) => {
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  return live
    .filter((e) => !(e.containerId && byId.has(e.containerId)))
    .map((e) => {
      const out = {
        id: e.id,
        type: e.type,
        x: round(e.x),
        y: round(e.y),
        width: round(e.width),
        height: round(e.height),
      };
      if (e.strokeColor && e.strokeColor !== "#1e1e1e") {
        out.strokeColor = e.strokeColor;
      }
      if (e.backgroundColor && e.backgroundColor !== "transparent") {
        out.backgroundColor = e.backgroundColor;
      }
      if (e.type === "text") {
        out.text = e.text;
        out.fontSize = e.fontSize;
      }
      const label = labelOf(e, live);
      if (label) {
        out.label = { text: label.text, fontSize: label.fontSize };
      }
      if (LINEAR.has(e.type)) {
        out.points = e.points;
        if (e.startBinding) {
          out.start = { id: e.startBinding.elementId };
        }
        if (e.endBinding) {
          out.end = { id: e.endBinding.elementId };
        }
      }
      if (e.groupIds?.length) {
        out.groupIds = e.groupIds;
      }
      if (e.type === "image") {
        out.note = "image (pixels not shown)";
      }
      return out;
    });
};
