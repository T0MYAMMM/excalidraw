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

## Sets

- `aws-dea/`: AWS Certified Data Engineer – Associate service deep-dives for
  `aws-data-engineer-associate`. Style reference: the Kinesis Data Streams
  section (`kinesis-reference.json`). `runs.jsonl` logs every attempt (model,
  time, tokens, result).
