"""Draw study sections with Antigravity (agy) agents, following Thomas's model rule.

Rule: claude-opus-5-5-medium first; if Opus is out of quota, gemini-4-neon-medium;
if both are out, wait until the earliest reported reset and start again from Opus.
(Gemini Argon is never used: it failed every benchmark run.)

Each section is drawn into its own scratch drawing `svc-<slug>` (cleared before
every attempt), then validated; failures are retried.

Usage (from this folder):
    python3 -I agy_sections.py aws-dea [--only slug,slug] [--workers 4]
Writes <set>/runs.jsonl (one line per attempt) and <set>/results.json.
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
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I leaves this folder off the path
import validate  # noqa: E402

MODELS = ["claude-opus-5-5-medium", "gemini-4-neon-medium"]
API = "http://localhost:3000/api/files"
RUN_TIMEOUT_S = 900
MAX_VALIDATION_RETRIES = 2

log = logging.getLogger("agy_sections")


class QuotaBook:
    """Shared record of when each model's quota frees up again."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._blocked_until = {m: 0.0 for m in MODELS}

    def block(self, model: str, seconds: float) -> None:
        with self._lock:
            self._blocked_until[model] = max(self._blocked_until[model], time.time() + seconds)
        log.warning("%s out of quota for %.0f min", model, seconds / 60)

    def pick(self) -> str:
        """First model in rule order that has quota; waits if none has."""
        while True:
            with self._lock:
                now = time.time()
                for m in MODELS:
                    if self._blocked_until[m] <= now:
                        return m
                wait = min(self._blocked_until.values()) - now + 30
            log.warning("all models out of quota; waiting %.0f min for the next reset", wait / 60)
            time.sleep(wait)


def parse_reset_seconds(error: str) -> float:
    """'Resets in 4h55m19s' -> seconds (default 1 h if absent)."""
    m = re.search(r"Resets in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?", error)
    if not m or not any(m.groups()):
        return 3600.0
    h, mi, s = (int(g) if g else 0 for g in m.groups())
    return h * 3600 + mi * 60 + s


def is_quota_error(meta: dict) -> bool:
    text = f"{meta.get('error', '')} {meta.get('status', '')}"
    return "quota" in text.lower() or "RESOURCE_EXHAUSTED" in text


def reset_drawing(name: str) -> None:
    """Empty the scratch drawing (create it if missing)."""
    scene = json.dumps({"type": "excalidraw", "version": 2, "source": "agy-sections",
                        "elements": [], "appState": {"viewBackgroundColor": "#ffffff"}, "files": {}})
    url = f"{API}/{urllib.parse.quote(name)}"
    try:
        req = urllib.request.Request(url, data=scene.encode(), method="PUT", headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req)
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise
        body = json.dumps({"name": name, "content": scene}).encode()
        urllib.request.urlopen(urllib.request.Request(API, data=body, method="POST", headers={"Content-Type": "application/json"}))


def build_prompt(set_dir: Path, service: dict) -> str:
    template = (set_dir / "prompt-template.md").read_text()
    rules = (Path(__file__).resolve().parent / "HIERARCHY.md").read_text()
    template = f"{rules}\n\n---\n\n{template}"

    reference = (set_dir / "kinesis-reference.json").read_text()
    return (template.replace("__REFERENCE__", reference).replace("__TITLE__", service["title"])
            .replace("__FOCUS__", service["focus"]).replace("__SLUG__", service["slug"])
            .replace("__DRAWING__", f"svc-{service['slug']}"))


def run_agy(prompt: str, model: str, workdir: Path) -> dict:
    proc = subprocess.run(
        ["agy", "-p", prompt, "--model", model, "--output-format", "json",
         "--dangerously-skip-permissions", "--sandbox", "--print-timeout", f"{RUN_TIMEOUT_S}s"],
        capture_output=True, text=True, timeout=RUN_TIMEOUT_S + 60, cwd=workdir,
    )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"status": "ERROR", "error": (proc.stderr or proc.stdout)[-500:]}


def draw_section(set_dir: Path, service: dict, quota: QuotaBook, journal: threading.Lock) -> dict:
    name = f"svc-{service['slug']}"
    prompt = build_prompt(set_dir, service)
    validation_failures = 0
    while True:
        model = quota.pick()
        reset_drawing(name)
        start = time.time()
        meta = run_agy(prompt, model, set_dir)
        result = validate.check_section(name, service["title"])
        entry = {"slug": service["slug"], "model": model, "status": meta.get("status"),
                 "seconds": round(time.time() - start), "usage": meta.get("usage"),
                 "error": meta.get("error"), "ok": result["ok"], "fails": result["fails"]}
        with journal, (set_dir / "runs.jsonl").open("a") as f:
            f.write(json.dumps(entry) + "\n")
        if result["ok"]:
            # a quota error after the drawing was finished still counts
            log.info("%s done with %s (%ss)", service["slug"], model, entry["seconds"])
            return entry
        if is_quota_error(meta):
            quota.block(model, parse_reset_seconds(meta.get("error", "")))
            continue
        validation_failures += 1
        log.warning("%s failed validation (%s): %s", service["slug"], model, "; ".join(result["fails"]))
        if validation_failures > MAX_VALIDATION_RETRIES:
            return entry


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("set", help="folder with services.json, prompt-template.md, kinesis-reference.json")
    parser.add_argument("--only", help="comma-separated slugs to run")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")

    set_dir = Path(args.set).resolve()
    services = json.loads((set_dir / "services.json").read_text())
    if args.only:
        wanted = set(args.only.split(","))
        services = [s for s in services if s["slug"] in wanted]
    quota, journal = QuotaBook(), threading.Lock()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda s: draw_section(set_dir, s, quota, journal), services))
    (set_dir / "results.json").write_text(json.dumps(results, indent=1))
    ok = sum(1 for r in results if r["ok"])
    log.info("%d/%d sections passed", ok, len(results))


if __name__ == "__main__":
    main()
