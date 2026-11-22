You are adding a study-notes section to Thomas's Excalidraw drawing through the `excalidraw-files` MCP server. Work only through its tools (`excalidraw_format_guide`, `add_elements`, `update_elements`, `delete_elements`). Do NOT call `read_drawing`; everything you need is below. Do not touch any existing element.

Drawing name: __DRAWING__

## Task
Create a section about **__TITLE__** for the AWS Certified Data Engineer – Associate (DEA-C01) exam. Focus on: __FOCUS__

Use the same structure, style and density as the existing "Amazon Kinesis Data Streams" section given below as a reference.

## Hard requirements
1. Section box: a rectangle with id `__SLUG__-box`, x 5575, y -9590, width 660, height 589, backgroundColor `#f3f0ff`, strokeWidth 4, roughness 0. It MUST be the first element of your first `add_elements` call (array order = drawing order, so it stays behind the content).
2. Every other element must lie fully inside the box: x from 5590 to 6220, y from -9575 to -9010. Use ids starting with `__SLUG__-`.
3. Same four parts as the reference, in this order: a title text `- __TITLE__` (fontSize 16) with a 2–3 line description (fontSize 11) and a small 3-box flow at the top right; `- Main Features` with 4 numbered feature cards (135x31) each with a 2-line explanation text (fontSize 9) to the right; `- Illustration` with a small diagram built from labelled rectangles and arrows that connect shapes with `start`/`end`; `- Exam Tips & Traps` with 4 numbered tips (fontSize 8.5).
4. Same style as the reference: cards strokeWidth 1, roughness 0, the same fill colours (#38d9a9 / #96f2d7 alternating for feature cards, #e6fcf5 for other boxes), label fontSize 8.36; arrows strokeWidth 1, roughness 0.
5. Text must not overlap other text or shapes; card labels must fit inside their cards (keep labels short). Facts must be accurate and current; prefer what the exam tests (limits, when to choose this service over alternatives, common traps). Write real line breaks in multi-line text, never a literal backslash-n.
6. Use as few tool calls as you can (ideally one `add_elements` call). If a call returns an error, fix the input and retry.

## Reference: the Kinesis section (compact format, its box was at x 5575, y -10269)
```json
__REFERENCE__
```

When done, reply with one line: how many elements you added.
