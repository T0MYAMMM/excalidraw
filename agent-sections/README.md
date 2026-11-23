# agent-sections

Study-note sections for Thomas's drawings, drawn by Antigravity (`agy`) agents
through the `excalidraw-files` MCP server, checked automatically, then merged
into the target drawing.

## Model rule

1. `claude-opus-5-5-medium` first.
2. If Opus is out of quota ("Third-party quota reached… Resets in …"), use
   `gemini-4-neon-medium`.
3. If Neon is out too, wait until the earliest reset either error reports,
   then start again from Opus.

Gemini Argon is never used. In the 2026-11-21 Redshift benchmark (3 runs per
model): Opus passed 3/3 (54 s, ~5.8k output tokens per section), Neon 3/3
(84 s, ~14.9k), Argon 0/3 (it wrote a literal `\n`, so text ran outside the box).
`agy_sections.py` applies the rule by itself.

See [HIERARCHY.md](HIERARCHY.md) for the colour hierarchy and layout rules every agent follows. It is prepended to every agent prompt.

## Before you start

- The containers are running (`docker compose up -d` in the repo root; see
  [LOCAL-STACK.md](../LOCAL-STACK.md)).
- `excalidraw-files` is registered in agy:
  `agy mcp add excalidraw-files node "$PWD/../mcp-server/index.mjs"` (run from
  this folder). Agents draw through its tools.
- Python 3 and Node 20+. The `materials/agy_*.py` scripts also need
  `jsonschema`.
- Keep working files in this folder, not in `/tmp` or a scratchpad folder. A
  reboot has wiped one before.
- Most scripts take `--dry-run`, which reads `~/drawings/<name>.excalidraw`
  directly and changes nothing. Real runs write through the file API with a
  version check (`client.mjs` `modify`).

## Workflow

```bash
cd ~/references/diagramming/excalidraw/agent-sections
python3 -I agy_sections.py aws-dea [--only slug,slug] [--workers 4]   # draw into svc-<slug>
python3 -I check_all.py aws-dea                                       # validate all, writes passed.json
node merge.mjs aws-dea aws-data-engineer-associate --dry-run          # then without --dry-run
```

- Each section is drawn in its own scratch drawing `svc-<slug>`, box at
  (5575, -9590), and the scratch drawing is cleared before every attempt.
- `validate.py` checks, per section: one `#f3f0ff` box behind its content,
  everything inside it, the four parts (title, Main Features, Illustration,
  Exam Tips & Traps), arrows attached at both ends, labels that fit, no
  overlapping text, no literal `\n`. Text width is estimated at 0.5 × font
  size per character, calibrated on the approved Kinesis section.
- `merge.mjs` places sections in columns (`layout.json`), groups each
  section (`group_sections.mjs`) so it moves as one, adds column
  headings, and writes the target with a version check (`If-Match`). Back up
  the target drawing first.

## Materials

A material is the orange notes box for one lesson (see
[HIERARCHY.md](HIERARCHY.md#materials) for what a good one looks like). The
block-based pipeline, run from this folder:

```bash
# 1. design a brief, write the spec, check it fits (nothing is drawn yet)
python -I materials/agy_all_materials.py <lessons_dir> 9-29 [--workers 3]
# 2. draw the specs into their material boxes
node materials/render_blocks.mjs aws-data-engineer-associate aws-dea/material-specs-v2 9,10,11 --dry-run
node materials/render_blocks.mjs aws-data-engineer-associate aws-dea/material-specs-v2 9,10,11
# 3. give every table row the header row's column widths
node materials/equalize_tables.mjs aws-data-engineer-associate 9,10,11
# 4. link finished materials to the service sections they mention
node aws-dea/link_services.mjs --dry-run
```

- Numbers are material rows in study order. Each script's docstring has its
  current options.
- `agy_all_materials.py` writes the brief to `aws-dea/material-briefs.json`
  and the spec to `aws-dea/material-specs-v2/NN-<lesson>.json`. When
  `render_blocks.mjs --dry-run` says a spec doesn't fit the 589 px box, the
  writer retries with "shorten" feedback. `agy_block_specs.py` runs only the
  write step, from existing briefs. Run them with a Python that has
  `jsonschema`.
- `render_blocks.mjs` refuses a material that has no `- Template` heading left
  (one already filled in) unless the spec sets `replace_existing`.
- Older single-layout pipeline: `materials/agy_material_specs.py`, then
  `materials/render_set.mjs`, with specs in `aws-dea/material-specs/`.

## Other scripts

| Script | What it does |
|---|---|
| `group_sections.mjs <drawing> [--dry-run]` | Groups each violet section box with everything inside it (`merge.mjs` calls it) |
| `aws-dea/restructure.mjs [--dry-run <out.excalidraw>]` | One-off: re-spaced the DEA drawing to the HIERARCHY.md row layout |
| `aws-dea/link_services.mjs [--dry-run]` | Links finished materials to their service sections; safe to rerun. Stops without changing anything if a material is ungrouped |

Scripts that change many elements: back up the drawing first (naming in
[HIERARCHY.md](HIERARCHY.md#working-rules-for-agents)). Element ids can change
when the browser saves a drawing, so find elements by type, colour, size, text
or link, and match labels to boxes both ways (`boundElements` and
`containerId`). The cause is explained in
[LOCAL-STACK.md](../LOCAL-STACK.md#troubleshooting).

## Sets

- `aws-dea/`: AWS Certified Data Engineer – Associate service deep-dives for
  `aws-data-engineer-associate`. Style reference: the Kinesis Data Streams
  section (`kinesis-reference.json`). `runs.jsonl` logs every attempt (model,
  time, tokens, result).
  - `services.json` (slug, title, focus, column), `prompt-template.md`,
    `layout.json`: inputs for the service sections. `passed.json` and
    `results.json` are outputs.
  - `curriculum.json`: the cert → path → module → lesson tree exported from
    cert.yaml. `lesson-services.json`: which lesson row each service sits in.
  - `material-briefs.json`, `material-specs-v2/`: block-based material briefs
    and specs. `material-specs/`: specs for the older pipeline.
  - `materials/`: one-off scripts that filled and revised material 3, before
    the pipeline existed.
