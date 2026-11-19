/**
 * Element format guide returned by the `excalidraw_format_guide` tool.
 * Adapted from the official excalidraw-mcp cheat sheet (MIT).
 */
export const GUIDE = `# Excalidraw element format (excalidraw-files MCP)

Drawings live in Thomas's self-hosted Excalidraw (http://localhost:3000,
Files tab in the right sidebar). Changes you make show up there within a
few seconds, even in an open tab.

## Coordinates
- x grows to the right, y grows downwards; units are pixels at 100% zoom.
- x/y is the top-left corner of an element.
- A comfortable canvas for one diagram is about 1200 x 800.

## Element types
Every element needs a unique \`id\` (short, readable ids like "api", "db",
"a1" make later edits easy). Optional style on any element:
strokeColor, backgroundColor, fillStyle ("solid" | "hachure" |
"cross-hatch"), strokeWidth (1 | 2 | 4), strokeStyle ("solid" | "dashed" |
"dotted"), roughness (0 = clean, 1 = hand-drawn, 2 = sketchy), opacity
(0-100), groupIds.

**Shapes**: rectangle, ellipse, diamond, all with x, y, width, height.
Add \`label\` for centred text inside; no separate text element needed:
\`{ "type": "rectangle", "id": "api", "x": 100, "y": 100, "width": 200, "height": 80,
  "backgroundColor": "#a5d8ff", "label": { "text": "API server" } }\`

**Arrows / lines**: connect shapes with \`start\` and \`end\`. The arrow is
routed between the shapes' edges and stays attached when they move, so
coordinates are optional:
\`{ "type": "arrow", "id": "a1", "start": { "id": "api" }, "end": { "id": "db" },
  "label": { "text": "SQL" } }\`
A free arrow needs x, y and points relative to x/y:
\`{ "type": "arrow", "id": "a2", "x": 100, "y": 300, "points": [[0, 0], [200, 0]] }\`
Arrowheads: startArrowhead / endArrowhead = null | "arrow" | "triangle" |
"bar" | "dot" (arrows default to an end arrowhead; lines have none).

**Text**: free text with x, y, text, fontSize (default 20; use 16+ for body
text, 28-36 for titles). Use \\n for line breaks.
\`{ "type": "text", "id": "title", "x": 100, "y": 30, "text": "Checkout flow", "fontSize": 32 }\`

Images, frames and freehand strokes can't be created through this server.

## Colours (Excalidraw palette)
Strokes: #1e1e1e black, #e03131 red, #2f9e44 green, #1971c2 blue,
#f08c00 orange, #6741d9 violet.
Fills (pastel): #ffc9c9 red, #b2f2bb green, #a5d8ff blue, #ffec99 yellow,
#d0bfff violet, #e9ecef grey.
Use one fill per kind of thing (e.g. services blue, data stores green).

## Layout tips
- Shapes with labels: at least 140 x 60; leave 60-100 px between shapes.
- Lay flows out left-to-right or top-to-bottom on a grid (x = 100, 400, 700…).
- Keep labels short (1-4 words); put detail in a nearby text element.

## Workflow
1. list_drawings / read_drawing to see what exists. read_drawing shows each
   element compactly (labels folded into their shapes).
2. create_drawing for a new drawing (optionally with its first elements).
3. add_elements, update_elements ({ id, ...changed props }; label: null
   removes a label; moving a shape drags its label and arrows along) and
   delete_elements (also removes their labels) for edits.
Edits are applied to the latest version on disk, so they never overwrite
what Thomas is drawing at the same time.

## Example: two connected boxes
create_drawing { "name": "Login flow", "elements": [
  { "type": "rectangle", "id": "web", "x": 100, "y": 100, "width": 180, "height": 80, "backgroundColor": "#a5d8ff", "label": { "text": "Web app" } },
  { "type": "rectangle", "id": "auth", "x": 450, "y": 100, "width": 180, "height": 80, "backgroundColor": "#b2f2bb", "label": { "text": "Auth service" } },
  { "type": "arrow", "id": "a1", "start": { "id": "web" }, "end": { "id": "auth" }, "label": { "text": "POST /login" } }
] }
`;
