/**
 * MCP server for Thomas's self-hosted Excalidraw drawings.
 *
 * Reads and edits the drawings the Excalidraw file manager stores in
 * ~/drawings, through the same file-server API the browser uses, so new
 * drawings and edits show up in the app's Files tab.
 *
 * Deliberately has no tool that deletes or renames drawings: that stays a
 * human action in the app (where deletes go to the trash).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { createClient, emptyScene } from "./client.mjs";
import {
  ElementError,
  addElements,
  deleteElements,
  describeElements,
  updateElements,
} from "./elements.mjs";
import { GUIDE } from "./guide.mjs";

const element = z
  .looseObject({
    type: z
      .string()
      .describe("rectangle | ellipse | diamond | arrow | line | text"),
    id: z.string().optional(),
  })
  .describe("Element in the compact format (see excalidraw_format_guide)");

const elementList = z
  .array(element)
  .describe("Elements in the compact format (see excalidraw_format_guide)");

const drawingName = z
  .string()
  .min(1)
  .max(100)
  .describe('Drawing name as shown in the Files tab (no / \\ : * ? " < > |)');

const text = (value) => ({
  content: [
    {
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

/** Turns expected failures into tool errors the agent can read and fix. */
const safely = (handler) => async (args) => {
  try {
    return await handler(args);
  } catch (error) {
    const known = error instanceof ElementError || error.status !== undefined;
    if (!known) {
      throw error;
    }
    return { ...text(`Error: ${error.message}`), isError: true };
  }
};

/** Creates the MCP server bound to one Excalidraw instance. */
export const createServer = ({ baseUrl }) => {
  const files = createClient(baseUrl);
  const server = new McpServer({ name: "excalidraw-files", version: "1.0.0" });

  server.registerTool(
    "excalidraw_format_guide",
    {
      description:
        "How to describe Excalidraw elements (shapes, labels, arrows, text, colours, layout). Read this before creating or editing drawings.",
      annotations: { readOnlyHint: true },
    },
    async () => text(GUIDE),
  );

  server.registerTool(
    "list_drawings",
    {
      description:
        "List Thomas's Excalidraw drawings (most recently edited first).",
      annotations: { readOnlyHint: true },
    },
    safely(async () => {
      const list = await files.list();
      return text(
        list.length
          ? list.map(({ name, updatedAt }) => ({ name, updatedAt }))
          : "No drawings yet.",
      );
    }),
  );

  server.registerTool(
    "read_drawing",
    {
      description:
        "Read a drawing's elements in the compact format (labels folded into their shapes, default styles left out).",
      inputSchema: { name: drawingName },
      annotations: { readOnlyHint: true },
    },
    safely(async ({ name }) => {
      const { scene } = await files.read(name);
      return text({
        name,
        background: scene.appState?.viewBackgroundColor ?? "#ffffff",
        elements: describeElements(scene.elements ?? []),
      });
    }),
  );

  server.registerTool(
    "create_drawing",
    {
      description:
        "Create a new drawing, optionally with its first elements. Fails if the name is taken.",
      inputSchema: {
        name: drawingName,
        elements: elementList.optional(),
      },
    },
    safely(async ({ name, elements = [] }) => {
      const scene = emptyScene();
      const ids = addElements(scene.elements, elements);
      const info = await files.create(name, scene);
      return text(
        `Created "${info.name}" with ${ids.length} element(s). Thomas can open it from the Files tab at ${baseUrl}.`,
      );
    }),
  );

  server.registerTool(
    "add_elements",
    {
      description: "Add elements to an existing drawing.",
      inputSchema: { name: drawingName, elements: elementList.min(1) },
    },
    safely(async ({ name, elements }) => {
      const ids = await files.modify(name, (scene) =>
        addElements(scene.elements, elements),
      );
      return text(`Added ${ids.length} element(s): ${ids.join(", ")}`);
    }),
  );

  server.registerTool(
    "update_elements",
    {
      description:
        "Change elements by id: { id, ...props to change }. `label: { text }` sets a shape's or arrow's label, `label: null` removes it; `start`/`end` re-attach an arrow. Moving a shape keeps its label and arrows attached.",
      inputSchema: {
        name: drawingName,
        updates: z.array(z.looseObject({ id: z.string() })).min(1),
      },
    },
    safely(async ({ name, updates }) => {
      await files.modify(name, (scene) =>
        updateElements(scene.elements, updates),
      );
      return text(`Updated ${updates.length} element(s).`);
    }),
  );

  server.registerTool(
    "delete_elements",
    {
      description:
        "Delete elements by id (their labels go too; arrows attached to them stay but come loose).",
      inputSchema: {
        name: drawingName,
        ids: z.array(z.string()).min(1),
      },
      annotations: { destructiveHint: true },
    },
    safely(async ({ name, ids }) => {
      const removed = await files.modify(name, (scene) =>
        deleteElements(scene.elements, ids),
      );
      return text(`Deleted ${removed.length} element(s).`);
    }),
  );

  return server;
};
