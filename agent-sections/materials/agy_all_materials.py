"""Design, write and fit-check block materials for many lessons with agy agents.

Per material, in one worker:
  1. design: an agent reads the lesson and returns a brief (blocks.schema
     block types per column) plus a coverage map putting every lesson
     subtopic in a block, so no topic is left out. Saved into
     aws-dea/material-briefs.json.
  2. write: an agent fills the brief concisely (agy_block_specs prompt and
     checks). Saved to aws-dea/material-specs-v2/NN-<lesson>.json.
  3. fit: render_blocks.mjs --dry-run must fit the fixed 589 px box; if not,
     the writer retries with "shorten" feedback.
Model order follows Thomas's rule (Opus 5.5 medium -> Gemini Neon medium on
quota -> wait for the earliest reset). Nothing is drawn; apply with
render_blocks.mjs afterwards.

Usage (needs jsonschema, e.g. ~/gcp/findme/.venv/bin/python):
    python -I agy_all_materials.py <lessons_dir> <first>-<last> [--workers 3]
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import jsonschema

HERE = Path(__file__).resolve().parent
DEA = HERE.parent / "aws-dea"
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from agy_block_specs import PROMPT as WRITE_PROMPT  # noqa: E402
from agy_block_specs import brief_text  # noqa: E402
from agy_block_specs import check as check_spec  # noqa: E402
from agy_material_specs import parse_response  # noqa: E402
from agy_sections import QuotaBook, is_quota_error, parse_reset_seconds  # noqa: E402

BRIEF_SCHEMA = HERE / "brief.schema.json"
SPEC_SCHEMA = HERE / "blocks.schema.json"
BRIEFS = DEA / "material-briefs.json"
SPECS = DEA / "material-specs-v2"
DRAWING = "aws-data-engineer-associate"
RUN_TIMEOUT_S = 1200
MAX_TRIES = 4
SKIP_TOPICS = ("why this matters", "key takeaways")
log = logging.getLogger("agy_all_materials")

DESIGN_PROMPT = """You design the layout of one study-note "material" for Thomas's AWS Certified
Data Engineer – Associate (DEA-C01) notes in Excalidraw. A script draws it from
your design in a FIXED box (about 1550 x 510 px of content area, three columns),
so the design must summarise the whole lesson concisely: every subtopic gets a
short summary somewhere, nothing is explained at length.

Return a JSON object: "blocks" (stacking order) and "coverage".

Columns: "left" (about 490 px wide), "middle" (470 px), "right" (550 px),
"middle-right" (one wide block across both, use rarely).
Fixed anchors on every material:
- left: a "concepts" block (heading "Core Concepts", count 2-4) and, LAST in the
  left column, a "tips" block (exam tips & traps).
- right: a "decisions" block (the lesson's decision guide), normally last.
Choose the other 2-4 blocks to fit THIS lesson's content, so materials don't all
look alike. Pick by what the content is:
- callouts: key numbers/limits (count 2-4)        - compare: two options side by side
- timeline: lifecycle, retention, windows, stages in time
- pipeline: a linear flow with an optional error/backup branch
- decision_tree: a yes/no choice path            - flowchart: producers -> service -> consumers (set "height" 150-220)
- pairs: term mapping (A <-> B)                  - cluster: a family of related services/features
- table: facts / options with 2-3 attributes
Budget (it must fit): at most 3 blocks per column, 7-8 blocks total. A flowchart
or decision_tree takes most of a column. Concepts count 2-3 when the left column
also holds callouts.
"why" tells the writer exactly which lesson facts go in that block.

"coverage": list EVERY subtopic of the lesson (each "###" heading, and each "##"
section that has no "###" under it, except "Why this matters" and "Key
takeaways") with the 1-based index of the block that summarises it. Use the
heading text as "topic".

Two designs Thomas approved, for other lessons:
{examples}

The lesson ({lesson_id}):
---
{lesson}
---

Return only the JSON object."""


def subtopics(lesson: str) -> list[str]:
    """### headings, plus ## sections without ### (code fences skipped)."""
    out: list[str] = []
    fence = False
    h2: str | None = None
    h2_has_h3 = False
    for line in lesson.splitlines():
        if line.startswith("```"):
            fence = not fence
            continue
        if fence:
            continue
        if line.startswith("## "):
            if h2 and not h2_has_h3:
                out.append(h2)
            h2, h2_has_h3 = line[3:].strip(), False
        elif line.startswith("### "):
            h2_has_h3 = True
            out.append(line[4:].strip())
    if h2 and not h2_has_h3:
        out.append(h2)
    return [t for t in out if not t.lower().startswith(SKIP_TOPICS)]


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def check_brief(brief: dict, topics: list[str]) -> list[str]:
    """Problems with a design brief (empty = valid)."""
    try:
        jsonschema.validate(brief, json.loads(BRIEF_SCHEMA.read_text()))
    except jsonschema.ValidationError as exc:
        return [f"schema: {exc.message[:200]} at {list(exc.absolute_path)}"]
    blocks = brief["blocks"]
    problems = []
    left = [b["type"] for b in blocks if b["col"] == "left"]
    if "concepts" not in left:
        problems.append('left column needs a "concepts" block')
    if not left or left[-1] != "tips":
        problems.append('"tips" must be the last block of the left column')
    if not any(
        b["type"] == "decisions" and b["col"] in ("right", "middle-right")
        for b in blocks
    ):
        problems.append('right column needs a "decisions" block')
    for col in ("left", "middle", "right"):
        n = sum(
            1
            for b in blocks
            if b["col"] == col or (b["col"] == "middle-right" and col != "left")
        )
        if n > 3:
            problems.append(f"{col} column has {n} blocks; at most 3")
    extra = {b["type"] for b in blocks} - {"concepts", "tips", "decisions"}
    if len(extra) < 2:
        problems.append(
            "choose at least 2 lesson-specific block types besides concepts/tips/decisions"
        )
    mapped = {
        norm(c["topic"]) for c in brief["coverage"] if 1 <= c["block"] <= len(blocks)
    }
    missing = [t for t in topics if norm(t) not in mapped]
    if missing:
        problems.append(
            "coverage misses these subtopics (use the heading text): "
            + "; ".join(missing)
        )
    return problems


def run_agy(prompt: str, model: str, schema: Path) -> dict:
    proc = subprocess.run(
        [
            "agy",
            "-p",
            prompt,
            "--model",
            model,
            "--output-format",
            "json",
            "--json-schema",
            str(schema),
            "--sandbox",
            "--print-timeout",
            f"{RUN_TIMEOUT_S}s",
        ],
        capture_output=True,
        text=True,
        timeout=RUN_TIMEOUT_S + 60,
        cwd=HERE,
    )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"status": "ERROR", "error": (proc.stderr or proc.stdout)[-500:]}


def fit_problems(n: int) -> list[str]:
    """Dry-run the renderer on material n; problems if it doesn't fit."""
    proc = subprocess.run(
        ["node", "render_blocks.mjs", DRAWING, str(SPECS), str(n), "--dry-run"],
        capture_output=True,
        text=True,
        timeout=180,
        cwd=HERE,
    )
    if proc.returncode == 0:
        return []
    msg = re.search(r"Error: (.*)", proc.stderr)
    text = msg.group(1) if msg else proc.stderr[-300:]
    if "doesn't fit" in text:
        return [
            f"the material is too long for the fixed box ({text}). Shorten every text, "
            "drop the least important points but keep one short line per subtopic"
        ]
    return [f"renderer error: {text}"]


class Runner:
    """Runs design -> write -> fit for materials, sharing quota and files."""

    def __init__(self, lessons: Path, curriculum: list[dict]) -> None:
        self.lessons = lessons
        self.curriculum = curriculum
        self.quota = QuotaBook()
        self.lock = threading.Lock()

    def journal(self, entry: dict) -> None:
        with self.lock, (SPECS / "runs.jsonl").open("a") as f:
            f.write(json.dumps(entry) + "\n")

    def ask(
        self, n: int, step: str, prompt: str, schema: Path, validate
    ) -> dict | None:
        """One agent step with quota fallback and retry feedback."""
        feedback = ""
        for _ in range(MAX_TRIES):
            while True:
                model = self.quota.pick()
                start = time.time()
                meta = run_agy(prompt + feedback, model, schema)
                if meta.get("status") != "SUCCESS" and is_quota_error(meta):
                    self.quota.block(model, parse_reset_seconds(meta.get("error", "")))
                    continue
                break
            value = parse_response(meta) if meta.get("status") == "SUCCESS" else None
            problems = (
                validate(value)
                if value
                else [f"no JSON in the reply ({meta.get('error', '')[:120]})"]
            )
            self.journal(
                {
                    "material": n,
                    "step": step,
                    "model": model,
                    "status": meta.get("status"),
                    "seconds": round(time.time() - start),
                    "problems": problems,
                }
            )
            if not problems:
                return value
            log.warning("material %d %s: %s", n, step, problems)
            feedback = (
                "\n\nYour previous answer had these problems; fix them:\n- "
                + "\n- ".join(problems)
            )
        return None

    def design(self, n: int, lesson_id: str, lesson: str) -> dict | None:
        briefs = json.loads(BRIEFS.read_text())
        if str(n) in briefs:
            return briefs[str(n)]
        examples = json.dumps(
            {k: briefs[k] for k in ("5", "8")}, indent=1, ensure_ascii=False
        )
        topics = subtopics(lesson)
        prompt = DESIGN_PROMPT.format(
            examples=examples, lesson_id=lesson_id, lesson=lesson
        )
        got = self.ask(
            n, "design", prompt, BRIEF_SCHEMA, lambda b: check_brief(b, topics)
        )
        if not got:
            return None
        brief = {
            "lesson": lesson_id,
            "blocks": got["blocks"],
            "coverage": got["coverage"],
        }
        with self.lock:
            briefs = json.loads(BRIEFS.read_text())
            briefs[str(n)] = brief
            BRIEFS.write_text(json.dumps(briefs, indent=1, ensure_ascii=False) + "\n")
        return brief

    def write(self, n: int, lesson_id: str, lesson: str, brief: dict) -> bool:
        path = SPECS / f"{n:02d}-{lesson_id}.json"
        prompt = WRITE_PROMPT.format(
            brief=brief_text(brief), lesson_id=lesson_id, lesson=lesson
        )
        cover = "\n".join(
            f"- block {c['block']}: {c['topic']}" for c in brief.get("coverage", [])
        )
        prompt += (
            "\n\nflowchart: 2-3 groups, node labels <= 22 chars, edge labels <= 14 chars."
            "\n\nCover every lesson subtopic with at least one short line, in these blocks:\n"
            + cover
            + "\nSummarise; don't copy the lesson's sentences."
        )

        def validate(spec: dict) -> list[str]:
            problems = check_spec(spec, brief)
            problems += [
                "flowchart: use at most 3 groups"
                for b in spec.get("blocks", [])
                if b.get("type") == "flowchart" and len(b.get("groups", [])) > 3
            ]
            if problems:
                return problems
            spec["replace_existing"] = True
            with self.lock:  # the renderer reads the spec from disk
                path.write_text(json.dumps(spec, indent=1, ensure_ascii=False) + "\n")
            problems = fit_problems(n)
            if problems:
                path.unlink(missing_ok=True)
            return problems

        return self.ask(n, "write", prompt, SPEC_SCHEMA, validate) is not None

    def material(self, n: int) -> dict:
        lesson_id = self.curriculum[n - 1]["id"]
        lesson = (self.lessons / f"{lesson_id}.md").read_text()
        brief = self.design(n, lesson_id, lesson)
        ok = bool(brief) and self.write(n, lesson_id, lesson, brief)
        log.info("material %d (%s): %s", n, lesson_id, "ready" if ok else "FAILED")
        return {"material": n, "lesson": lesson_id, "ok": ok}


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S"
    )
    ap = argparse.ArgumentParser()
    ap.add_argument("lessons", type=Path)
    ap.add_argument("rows", help="first-last (9-60) or a list (9,11,12)")
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()
    if "-" in args.rows:
        first, last = (int(x) for x in args.rows.split("-"))
        rows = list(range(first, last + 1))
    else:
        rows = [int(x) for x in args.rows.split(",")]
    cur = json.loads((DEA / "curriculum.json").read_text())
    curriculum = [
        les for p in cur["phases"] for m in p["modules"] for les in m["lessons"]
    ]
    runner = Runner(args.lessons.expanduser(), curriculum)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(runner.material, rows))
    failed = [r["material"] for r in results if not r["ok"]]
    log.info(
        "%d/%d materials ready; failed: %s",
        len(results) - len(failed),
        len(results),
        failed or "none",
    )


if __name__ == "__main__":
    main()
