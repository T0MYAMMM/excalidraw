// Run with: node --test mcp-server/elements.nodetest.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ElementError,
  addElements,
  deleteElements,
  describeElements,
  updateElements,
} from "./elements.mjs";

const box = (id, x, y = 100) => ({
  type: "rectangle",
  id,
  x,
  y,
  width: 200,
  height: 100,
});

const byId = (elements) => new Map(elements.map((e) => [e.id, e]));

test("builds full elements with defaults", () => {
  const elements = [];
  addElements(elements, [box("a", 0)]);
  const [a] = elements;
  assert.equal(a.type, "rectangle");
  assert.deepEqual(a.roundness, { type: 3 });
  assert.equal(a.strokeColor, "#1e1e1e");
  assert.equal(a.isDeleted, false);
  assert.ok(Number.isInteger(a.seed));
});

test("a label becomes a bound, centred text element", () => {
  const elements = [];
  addElements(elements, [{ ...box("a", 0), label: { text: "Hi" } }]);
  const [shape, label] = elements;
  assert.equal(label.type, "text");
  assert.equal(label.containerId, "a");
  assert.deepEqual(shape.boundElements, [{ id: label.id, type: "text" }]);
  assert.equal(label.x + label.width / 2, 100); // centred on the 200-wide box
  assert.equal(label.verticalAlign, "middle");
});

test("arrows between shapes are routed edge to edge and bound", () => {
  const elements = [];
  addElements(elements, [
    box("a", 0),
    box("b", 400),
    { type: "arrow", id: "a1", start: { id: "a" }, end: { id: "b" } },
  ]);
  const els = byId(elements);
  const arrow = els.get("a1");
  assert.equal(arrow.x, 208); // right edge of a (200) + gap 8
  assert.equal(arrow.y, 150); // vertical centre
  assert.deepEqual(arrow.points, [
    [0, 0],
    [184, 0],
  ]); // to left edge of b (400) - gap 8
  assert.equal(arrow.startBinding.elementId, "a");
  assert.equal(arrow.startBinding.mode, "orbit");
  assert.equal(arrow.endBinding.elementId, "b");
  assert.equal(arrow.endArrowhead, "arrow");
  assert.deepEqual(els.get("a").boundElements, [{ id: "a1", type: "arrow" }]);
});

test("arrows can be bound to shapes added earlier", () => {
  const elements = [];
  addElements(elements, [box("a", 0), box("b", 0, 400)]);
  addElements(elements, [
    { type: "arrow", id: "down", start: { id: "a" }, end: { id: "b" } },
  ]);
  const arrow = byId(elements).get("down");
  assert.equal(arrow.y, 208);
  assert.deepEqual(arrow.points[1], [0, 184]);
});

test("rejects duplicate ids, unknown types, bad targets and missing coords", () => {
  const elements = [];
  addElements(elements, [box("a", 0)]);
  assert.throws(() => addElements(elements, [box("a", 10)]), ElementError);
  assert.throws(
    () => addElements(elements, [{ type: "star", id: "s" }]),
    ElementError,
  );
  assert.throws(
    () =>
      addElements(elements, [
        { type: "arrow", id: "x", start: { id: "a" }, end: { id: "nope" } },
      ]),
    ElementError,
  );
  assert.throws(
    () => addElements(elements, [{ type: "rectangle", id: "r" }]),
    ElementError,
  );
});

test("moving a shape drags its label and attached arrows", () => {
  const elements = [];
  addElements(elements, [
    { ...box("a", 0), label: { text: "A" } },
    box("b", 400),
    { type: "arrow", id: "a1", start: { id: "a" }, end: { id: "b" } },
  ]);
  updateElements(elements, [{ id: "b", y: 400 }]);
  const els = byId(elements);
  const arrow = els.get("a1");
  const end = [arrow.x + arrow.points[1][0], arrow.y + arrow.points[1][1]];
  // the arrow now ends at b's new position (top-left area of b)
  assert.ok(end[1] > 390, `arrow end y ${end[1]}`);
  assert.ok(els.get("b").version > 1);

  updateElements(elements, [{ id: "a", x: 50 }]);
  const label = elements.find((e) => e.containerId === "a");
  assert.equal(label.x + label.width / 2, 150);
});

test("labels can be changed and removed", () => {
  const elements = [];
  addElements(elements, [{ ...box("a", 0), label: { text: "Old" } }]);
  updateElements(elements, [{ id: "a", label: { text: "New name" } }]);
  assert.equal(describeElements(elements)[0].label.text, "New name");
  updateElements(elements, [{ id: "a", label: null }]);
  assert.equal(describeElements(elements)[0].label, undefined);
  assert.equal(byId(elements).get("a").boundElements, null);
});

test("rejects updates to unknown ids and props", () => {
  const elements = [];
  addElements(elements, [box("a", 0)]);
  assert.throws(() => updateElements(elements, [{ id: "zz", x: 1 }]));
  assert.throws(() => updateElements(elements, [{ id: "a", seed: 1 }]));
});

test("deleting a shape removes its label and loosens arrows", () => {
  const elements = [];
  addElements(elements, [
    { ...box("a", 0), label: { text: "A" } },
    box("b", 400),
    { type: "arrow", id: "a1", start: { id: "a" }, end: { id: "b" } },
  ]);
  const removed = deleteElements(elements, ["a"]);
  assert.equal(removed.length, 2); // shape + its label
  const live = describeElements(elements);
  assert.deepEqual(
    live.map((e) => e.id),
    ["b", "a1"],
  );
  const arrow = live.find((e) => e.id === "a1");
  assert.equal(arrow.start, undefined);
  assert.deepEqual(arrow.end, { id: "b" });
});

test("describe folds labels and omits default styles", () => {
  const elements = [];
  addElements(elements, [
    { ...box("a", 0), backgroundColor: "#a5d8ff", label: { text: "API" } },
    { type: "text", id: "t", x: 0, y: 0, text: "Title", fontSize: 32 },
  ]);
  assert.deepEqual(describeElements(elements), [
    {
      id: "a",
      type: "rectangle",
      x: 0,
      y: 100,
      width: 200,
      height: 100,
      backgroundColor: "#a5d8ff",
      label: { text: "API", fontSize: 20 },
    },
    {
      id: "t",
      type: "text",
      x: 0,
      y: 0,
      width: 88,
      height: 40,
      text: "Title",
      fontSize: 32,
    },
  ]);
});
