# Certification note maps: hierarchy and layout rules

Thomas prepares for certifications with one Excalidraw drawing per exam,
built from his cert-academy course (`~/learning/cert-academy/<provider>/content/certs/<cert>/cert.yaml`).
The drawing reads **left to right, from the whole exam down to the details**,
and **top to bottom in study order**. Every agent that edits these drawings
must keep to these rules.

## The six levels (colour = meaning)

| Level | What it is | Fill (Excalidraw palette) | Source in cert-academy |
|---|---|---|---|
| 1 | Certification title (one box, plus exam facts and badge next to it) | Yellow-2 `#ffec99` | `cert.yaml`: `name`, `exam` |
| 2 | Learning path | Blue-2 `#a5d8ff` | `phases[]` |
| 3 | Module | Green-2 `#b2f2bb` | `phases[].modules[]` |
| 4 | Lesson | Teal-2 `#96f2d7` | `modules[].lessons[]` (+ `lessons/<id>.md` for titles) |
| 5 | Material: Thomas's notes for one lesson | Orange-1 `#fff4e6` | written by Thomas from the lesson |
| 6 | AWS service deep-dive | Violet-1 `#f3f0ff` | the service the lesson teaches |

Never reuse these fills for anything else, and never change a box's level by
recolouring it. Small cards *inside* a material or service section may use
their own colours (e.g. the teal/mint cards in service sections).

## Layout

- **Columns, left to right:** yellow → blue → green → teal → orange → violet.
- **One row per lesson, in cert.yaml order, top to bottom.** Each teal lesson
  box sits level with its orange material box; the violet services for that
  lesson sit to the right of the material, in the same row.
- A green module is centred on its lessons, a blue path on its modules, and the
  yellow title on its paths. Parents connect to children with arrows that are
  attached at both ends (so they follow when boxes move). Each lesson has an
  arrow to its material.
- Every material box has a title line just above it: `<n>. <lesson title>`
  (n = lesson number in study order).
- Each material and each service section is **one Excalidraw group**, so it
  moves as a unit. Put the material's title line in that group too.
- A service appears once, in the row of the lesson that teaches it most
  directly (see `aws-dea/lesson-services.json`). Lessons with no dedicated
  service have no violet section.
- The legend at the bottom shows the six fills and their meaning.

## Materials

- New materials start as a copy of Thomas's template: the orange box with
  `- Template` headings. Copy it unchanged (new ids, new group id), add the
  title line, and leave the content for Thomas to fill in.
- Never overwrite or move the content inside a material Thomas has started
  filling; only move the whole group.
- When a material is finished (no `- Template` heading left), link it to the
  services it mentions: `node aws-dea/link_services.mjs`. An element naming one
  service links straight to that section; a row of Violet-1 `↗ <service>` chips
  under the material (in the material's group) links to every service it
  mentions. Links use `http://localhost:3000/?element=<section box id>`. Rerun
  it after finishing more materials (old chips are replaced).

## Service sections

Drawn by agents with `agy_sections.py` (model rule in `README.md`): a
660 × 589 Violet-1 box with title + description + 3-box flow, Main Features
(4 cards), Illustration (shapes + attached arrows) and Exam Tips & Traps.
`validate.py` checks every section before it is merged.

## Working rules for agents

- Use only the `excalidraw-files` MCP tools or the scripts here; never
  hand-edit the `.excalidraw` file. Writes carry a version check, so a
  conflicting edit by Thomas is never overwritten.
- Back up the drawing before any change that moves many elements:
  `~/hamish-mycroft/.cleanup-backups/excalidraw/<drawing>_<YYYYMMDD>-<what>.excalidraw`.
- Don't call `read_drawing` on a full certification drawing (it's huge); work
  from cert.yaml and the specific section you are changing.
