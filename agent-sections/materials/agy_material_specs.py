"""Write material specs for cert-academy lessons with agy agents.

Each agent reads one lesson (markdown) and returns a spec that fits
spec.schema.json (concise by design: every field has a length limit).
Model order follows Thomas's rule (see ../agy_sections.py): Opus 5.5 medium,
then Gemini Neon medium on quota errors, then wait for the earliest reset.

Usage (needs jsonschema, e.g. ~/gcp/findme/.venv/bin/python):
    python -I agy_material_specs.py <lessons_dir> <out_dir> <n>:<lesson-id> [...]
Example:
    ... agy_material_specs.py ~/learning/cert-academy/aws/content/certs/data-engineer-associate/lessons \\
        ../aws-dea/material-specs 5:dea-kinesis-data-streams
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
from agy_sections import QuotaBook, is_quota_error, parse_reset_seconds  # noqa: E402

SCHEMA_PATH = HERE / "spec.schema.json"
EXAMPLE_PATH = HERE / "example-spec.json"
RUN_TIMEOUT_S = 600
MAX_INVALID = 2

log = logging.getLogger("agy_material_specs")

PROMPT = """You write the content of one study-note "material" for Thomas's AWS Certified
Data Engineer – Associate (DEA-C01) notes in Excalidraw. A layout script draws it,
so you only return JSON that matches the given schema. No file edits, no tools needed.

Rules:
- Use only facts from the lesson below. Be accurate and exam-focused.
- Be concise: short phrases, no filler. Respect every maxLength; shorter is better.
- concepts: the 3-4 most important ideas of the lesson. "tag" = the exact AWS
  service name(s) the concept is about (e.g. "Amazon Kinesis Data Streams"), or omit.
- steps: a real 3-step progression from the lesson (a lifecycle, flow or sequence).
- diagram: the lesson's architecture as 2-4 groups left to right (e.g. Producers,
  Stream, Consumers), 1-3 nodes per group, 2-7 edges with short verb labels.
  Edges should go between neighbouring groups; avoid edges that skip a group.
  Node ids are short lowercase words; every edge must use existing node ids.
- table: key facts, limits or a comparison (3-5 rows), e.g. quotas or modes.
- decisions: 4-6 rows of [if the scenario says..., choose..., because...] taken
  from the lesson's decision guide.
- tips: the 4 most useful exam tips or traps.

Here is an example for another lesson (Modern Data Architectures), showing the
depth and tone wanted:
{example}

The lesson ({lesson_id}):
---
{lesson}
---

Return only the JSON object."""


def check(spec: dict) -> list[str]:
    """Problems with a spec (empty list = valid)."""
    problems = []
    try:
        jsonschema.validate(spec, json.loads(SCHEMA_PATH.read_text()))
    except jsonschema.ValidationError as exc:
        problems.append(f"schema: {exc.message} at {list(exc.absolute_path)}")
        return problems
    ids = [n["id"] for g in spec["diagram"]["groups"] for n in g["nodes"]]
    if len(ids) != len(set(ids)):
        problems.append("diagram: duplicate node ids")
    for e in spec["diagram"]["edges"]:
        if e["from"] not in ids or e["to"] not in ids:
            problems.append(f"diagram: edge {e['from']} -> {e['to']} uses an unknown node")
    cols = len(spec["table"]["columns"])
    if any(len(r) != cols for r in spec["table"]["rows"]):
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


def parse_response(meta: dict) -> dict | None:
    """The spec from agy's reply: structured_output first, then the reply text."""
    structured = meta.get("structured_output")
    if isinstance(structured, dict):
        return structured
    text = (meta.get("response") or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    for candidate in (text, text[text.find("{") : text.rfind("}") + 1]):
        try:
            value = json.loads(candidate)
            if isinstance(value, dict):
                return value
        except json.JSONDecodeError:
            continue
    return None


def write_spec(lessons: Path, out: Path, n: int, lesson_id: str, quota: QuotaBook, journal: threading.Lock) -> dict:
    lesson = (lessons / f"{lesson_id}.md").read_text()
    prompt = PROMPT.format(example=EXAMPLE_PATH.read_text(), lesson_id=lesson_id, lesson=lesson)
    invalid = 0
    while True:
        model = quota.pick()
        start = time.time()
        meta = run_agy(prompt, model)
        spec = parse_response(meta) if meta.get("status") == "SUCCESS" else None
        problems = check(spec) if spec else ["no JSON in the reply"]
        entry = {"material": n, "lesson": lesson_id, "model": model, "status": meta.get("status"),
                 "seconds": round(time.time() - start), "usage": meta.get("usage"), "error": meta.get("error"),
                 "problems": problems if spec or meta.get("status") == "SUCCESS" else []}
        with journal, (out / "runs.jsonl").open("a") as f:
            f.write(json.dumps(entry) + "\n")
        if meta.get("status") != "SUCCESS" and is_quota_error(meta):
            quota.block(model, parse_reset_seconds(meta.get("error", "")))
            continue
        if spec and not problems:
            path = out / f"{n:02d}-{lesson_id}.json"
            path.write_text(json.dumps(spec, indent=1, ensure_ascii=False) + "\n")
            log.info("material %d (%s) written by %s in %ss", n, lesson_id, model, entry["seconds"])
            return {**entry, "path": str(path)}
        invalid += 1
        log.warning("material %d: invalid spec from %s: %s", n, model, problems or meta.get("error"))
        if invalid > MAX_INVALID:
            return entry


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    lessons, out = Path(sys.argv[1]).expanduser(), Path(sys.argv[2]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    jobs = [(int(a.split(":")[0]), a.split(":")[1]) for a in sys.argv[3:]]
    quota, journal = QuotaBook(), threading.Lock()
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda j: write_spec(lessons, out, j[0], j[1], quota, journal), jobs))
    ok = sum(1 for r in results if r.get("path"))
    log.info("%d/%d specs written", ok, len(results))


if __name__ == "__main__":
    main()
