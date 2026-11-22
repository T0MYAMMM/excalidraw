"""Validate every section of a set; write <set>/passed.json with the slugs that pass.

Usage: python3 -I check_all.py <set-dir>
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate  # noqa: E402

set_dir = Path(sys.argv[1])
passed = []
for s in json.loads((set_dir / "services.json").read_text()):
    r = validate.check_section(f"svc-{s['slug']}", s["title"])
    print(f"{s['slug']:13} {'PASS' if r['ok'] else 'FAIL'}  {'; '.join(r['fails'])}")
    if r["ok"]:
        passed.append(s["slug"])
(set_dir / "passed.json").write_text(json.dumps(passed))
print(f"{len(passed)} passed")
