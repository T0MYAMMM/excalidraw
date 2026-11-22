"""Checks an agent-drawn study section against the section rules.

A section is drawn in a scratch drawing with its box at SECTION_BOX. The
checks: nothing else touched, exactly one box (colour, position, behind its
content), everything inside the box, the four parts present, arrows attached
at both ends, labels fit their cards, no overlapping text, no literal "\\n".

Text width is estimated at 0.5 x font size per character, calibrated on the
approved Kinesis section (it passes every check).
"""

import json
from pathlib import Path

DRAWINGS = Path.home() / "drawings"
SECTION_BOX = {"x": 5575, "y": -9590, "w": 660, "h": 589}
INNER = (5590 - 2, -9575 - 2, 6220 + 2, -9010 + 2)  # small tolerance
BOX_COLOUR = "#f3f0ff"
CHAR_W = 0.5


def load_elements(name: str) -> list[dict]:
    """Elements of ~/drawings/<name>.excalidraw."""
    return json.loads((DRAWINGS / f"{name}.excalidraw").read_text())["elements"]


def _bbox(e: dict) -> tuple[float, float, float, float]:
    if e["type"] in ("arrow", "line"):
        xs = [e["x"] + p[0] for p in e["points"]]
        ys = [e["y"] + p[1] for p in e["points"]]
        return min(xs), min(ys), max(xs), max(ys)
    return e["x"], e["y"], e["x"] + e["width"], e["y"] + e["height"]


def _text_box(e: dict) -> tuple[float, float, float, float]:
    lines = e["text"].split("\n")
    w = max(len(line) for line in lines) * e["fontSize"] * CHAR_W
    h = len(lines) * e["fontSize"] * 1.25
    return e["x"], e["y"], e["x"] + w, e["y"] + h


def _overlap(a, b, pad: float = 1.0) -> bool:
    return a[0] + pad < b[2] and b[0] + pad < a[2] and a[1] + pad < b[3] and b[1] + pad < a[3]


def _inside(inner, outer) -> bool:
    return outer[0] <= inner[0] and inner[2] <= outer[2] and outer[1] <= inner[1] and inner[3] <= outer[3]


def check_section(name: str, title: str, baseline: dict | None = None) -> dict:
    """Validate the section titled `title` in drawing `name`.

    `baseline` maps element id -> element that must stay unchanged (empty for
    a scratch drawing). Returns {"ok": bool, "fails": [...], ...}.
    """
    baseline = baseline or {}
    res: dict = {"name": name, "fails": []}
    try:
        els = load_elements(name)
    except Exception as exc:
        res["fails"].append(f"file unreadable: {exc}")
        res["ok"] = False
        return res
    live = [e for e in els if not e.get("isDeleted")]
    by = {e["id"]: e for e in live}
    order = {e["id"]: i for i, e in enumerate(els)}

    changed = [i for i, e in baseline.items() if by.get(i) != e]
    if changed:
        res["fails"].append(f"{len(changed)} original elements changed/deleted")
    new = [e for e in live if e["id"] not in baseline]
    res["new"] = len(new)
    if not new:
        res["fails"].append("nothing added")
        res["ok"] = False
        return res

    boxes = [e for e in new if e["type"] == "rectangle" and abs(e["width"] - SECTION_BOX["w"]) < 5 and abs(e["height"] - SECTION_BOX["h"]) < 5]
    box = boxes[0] if len(boxes) == 1 else None
    if box is None:
        res["fails"].append(f"{len(boxes)} section boxes (want 1)")
    else:
        if abs(box["x"] - SECTION_BOX["x"]) > 2 or abs(box["y"] - SECTION_BOX["y"]) > 2:
            res["fails"].append(f"box at ({box['x']:.0f},{box['y']:.0f})")
        if box["backgroundColor"].lower() != BOX_COLOUR:
            res["fails"].append(f"box colour {box['backgroundColor']}")
        if any(order[e["id"]] < order[box["id"]] for e in new if e is not box):
            res["fails"].append("box not behind all section content")

    content = [e for e in new if e is not box]
    outside = [e["id"] for e in content if not _inside(_bbox(e), INNER)]
    if outside:
        res["fails"].append(f"{len(outside)} elements outside box: {outside[:3]}")

    texts = [e for e in content if e["type"] == "text"]
    free = [t for t in texts if not t.get("containerId")]
    parts = ["- " + title, "- Main Features", "- Illustration", "- Exam Tips"]
    missing = [p for p in parts if not any(t["text"].strip().startswith(p) for t in free)]
    if missing:
        res["fails"].append(f"missing parts: {missing}")

    arrows = [e for e in content if e["type"] == "arrow"]
    if not arrows:
        res["fails"].append("no arrows in the illustration")
    loose = [a["id"] for a in arrows if not (a.get("startBinding") and a.get("endBinding"))]
    if loose:
        res["fails"].append(f"{len(loose)} arrows not attached at both ends")

    tight = []
    for t in texts:
        c = by.get(t.get("containerId"))
        if c and c["type"] != "arrow":
            w = max(len(line) for line in t["text"].split("\n")) * t["fontSize"] * CHAR_W
            if w > c["width"] + 2:
                tight.append(t["text"][:30])
    if tight:
        res["fails"].append(f"{len(tight)} labels wider than their box: {tight[:3]}")

    shapes = [e for e in content if e["type"] in ("rectangle", "ellipse", "diamond")]
    clashes = 0
    for i, a in enumerate(free):
        ab = _text_box(a)
        clashes += sum(1 for b in free[i + 1:] if _overlap(ab, _text_box(b)))
        clashes += sum(1 for s in shapes if _overlap(ab, _bbox(s), pad=2) and not _inside(ab, _bbox(s)))
    if clashes:
        res["fails"].append(f"{clashes} text overlaps")

    escaped = [t["id"] for t in texts if "\\n" in t["text"]]
    if escaped:
        res["fails"].append(f"{len(escaped)} texts with a literal \\n")

    res["ok"] = not res["fails"]
    return res
