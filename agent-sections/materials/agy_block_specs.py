"""Write block-based material specs (blocks.schema.json) with agy agents.

Each material has a design brief (aws-dea/material-briefs.json) naming the
visual blocks that fit its lesson; the agent fills exactly those blocks from
the lesson. Model order follows Thomas's rule (Opus 5.5 medium -> Gemini Neon
medium on quota -> wait for the earliest reset).

Usage (needs jsonschema, e.g. ~/gcp/findme/.venv/bin/python):
    python -I agy_block_specs.py <lessons_dir> <briefs.json> <out_dir> <n> [<n> ...]
"""

from __future__ import annotations

import json
import logging
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import jsonschema

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from agy_material_specs import parse_response  # noqa: E402
from agy_sections import QuotaBook, is_quota_error, parse_reset_seconds  # noqa: E402

SCHEMA_PATH = HERE / "blocks.schema.json"
RUN_TIMEOUT_S = 600
MAX_INVALID = 2
log = logging.getLogger("agy_block_specs")

PROMPT = """You write the content of one study-note "material" for Thomas's AWS Certified
Data Engineer – Associate (DEA-C01) notes in Excalidraw. A layout script draws it,
so return only a JSON object matching the schema. No tools or file edits needed.

The design is fixed by this brief. Return exactly these blocks, in this order,
with these "type", "col" and "heading" values (and item counts where given):
{brief}

Block guidance:
- concepts: card name (<=18 chars), optional 1-3 word keyword, 1-2 short sentences,
  optional "tag" = exact AWS service name(s).
- callouts: big numbers or short values ("1 MB/s", "365 days") with a short label.
- compare: two sides, 2-4 short points each; optional one-line caption.
- timeline: "at" values are positions 0..1 along the axis. Lanes hold bars as
  [start, end] pairs in 0..1.
- pipeline: stages left to right; optional "branch" from stage index "from" to a target
  (e.g. an error/backup path) with a short label.
- decision_tree: first node is the start; "decision" nodes ask a yes/no question;
  edges from decisions carry "yes"/"no" labels; keep it to 6-9 nodes.
- flowchart: groups are columns left to right; edges mostly between neighbouring groups.
- table: rows have one cell per column.
- decisions: [if the scenario says..., choose..., because...] from the lesson's decision guide.
- tips: the most useful exam tips or traps.

Rules: only facts from the lesson; exam-focused; concise (short phrases, respect every
maxLength, shorter is better). Set "replace_existing": true.

The lesson ({lesson_id}):
---
{lesson}
---

Return only the JSON object."""


def brief_text(brief: dict) -> str:
    lines = []
    for i, b in enumerate(brief["blocks"], 1):
        extra = []
        if b.get("heading"):
            extra.append(f'heading "{b["heading"]}"')
        if b.get("count"):
            extra.append(f'{b["count"]} items')
        if b.get("height"):
            extra.append(f'height {b["height"]}')
        if b.get("why"):
            extra.append(f'content: {b["why"]}')
        lines.append(f'{i}. type "{b["type"]}", col "{b["col"]}"' + (" — " + "; ".join(extra) if extra else ""))
    return "\n".join(lines)


def check(spec: dict, brief: dict) -> list[str]:
    """Problems with a spec against the schema and its brief (empty = valid)."""
    try:
        jsonschema.validate(spec, json.loads(SCHEMA_PATH.read_text()))
    except jsonschema.ValidationError as exc:
        return [f"schema: {exc.message[:200]} at {list(exc.absolute_path)}"]
    problems = []
    got = [(b["type"], b["col"]) for b in spec["blocks"]]
    want = [(b["type"], b["col"]) for b in brief["blocks"]]
    if got != want:
        problems.append(f"blocks must be {want}, got {got}")
        return problems
    for b, wb in zip(spec["blocks"], brief["blocks"]):
        if wb.get("count") and len(b.get("items", [])) != wb["count"]:
            problems.append(f'{b["type"]}: needs {wb["count"]} items')
        if b["type"] in ("flowchart", "decision_tree"):
            ids = [n["id"] for n in (b["nodes"] if b["type"] == "decision_tree" else [n for g in b["groups"] for n in g["nodes"]])]
            if len(ids) != len(set(ids)):
                problems.append(f'{b["type"]}: duplicate node ids')
            for e in b["edges"]:
                if e["from"] not in ids or e["to"] not in ids:
                    problems.append(f'{b["type"]}: edge {e["from"]} -> {e["to"]} uses an unknown node')
        if b["type"] == "pipeline" and b.get("branch") and b["branch"]["from"] >= len(b["stages"]):
            problems.append("pipeline: branch.from is past the last stage")
        if b["type"] == "table" and any(len(r) != len(b["columns"]) for r in b["rows"]):
            problems.append("table: every row needs one cell per column")
    return problems


def run_agy(prompt: str, model: str) -> dict:
    proc = subprocess.run(
        ["agy", "-p", prompt, "--model", model, "--output-format", "json", "--json-schema", str(SCHEMA_PATH),
         "--sandbox", "--print-timeout", f"{RUN_TIMEOUT_S}s"],
        capture_output=True, text=True, timeout=RUN_TIMEOUT_S + 60, cwd=HERE,
    )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"status": "ERROR", "error": (proc.stderr or proc.stdout)[-500:]}


def write_spec(lessons: Path, briefs: dict, out: Path, n: int, quota: QuotaBook, journal: threading.Lock) -> dict:
    brief = briefs[str(n)]
    lesson_id = brief["lesson"]
    prompt = PROMPT.format(brief=brief_text(brief), lesson_id=lesson_id, lesson=(lessons / f"{lesson_id}.md").read_text())
    invalid = 0
    feedback = ""
    while True:
        model = quota.pick()
        start = time.time()
        meta = run_agy(prompt + feedback, model)
        spec = parse_response(meta) if meta.get("status") == "SUCCESS" else None
        problems = check(spec, brief) if spec else ["no JSON in the reply"]
        entry = {"material": n, "lesson": lesson_id, "model": model, "status": meta.get("status"),
                 "seconds": round(time.time() - start), "usage": meta.get("usage"), "error": meta.get("error"),
                 "problems": problems if meta.get("status") == "SUCCESS" else []}
        with journal, (out / "runs.jsonl").open("a") as f:
            f.write(json.dumps(entry) + "\n")
        if meta.get("status") != "SUCCESS" and is_quota_error(meta):
            quota.block(model, parse_reset_seconds(meta.get("error", "")))
            continue
        if spec and not problems:
            spec["replace_existing"] = True
            path = out / f"{n:02d}-{lesson_id}.json"
            path.write_text(json.dumps(spec, indent=1, ensure_ascii=False) + "\n")
            log.info("material %d (%s) written by %s in %ss", n, lesson_id, model, entry["seconds"])
            return {**entry, "path": str(path)}
        invalid += 1
        log.warning("material %d: invalid spec from %s: %s", n, model, problems or meta.get("error"))
        feedback = "\n\nYour previous answer had these problems; fix them:\n- " + "\n- ".join(problems)
        if invalid > MAX_INVALID:
            return entry


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    lessons, briefs_path, out = Path(sys.argv[1]).expanduser(), Path(sys.argv[2]), Path(sys.argv[3]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    briefs = json.loads(briefs_path.read_text())
    rows = [int(a) for a in sys.argv[4:]]
    quota, journal = QuotaBook(), threading.Lock()
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda n: write_spec(lessons, briefs, out, n, quota, journal), rows))
    log.info("%d/%d specs written", sum(1 for r in results if r.get("path")), len(results))


if __name__ == "__main__":
    main()
