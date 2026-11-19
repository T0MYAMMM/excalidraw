#!/usr/bin/env node
/**
 * Entry point: runs the excalidraw-files MCP server over stdio.
 *
 *   EXCALIDRAW_URL  where the Excalidraw app (and its /api/files) is served,
 *                   default http://localhost:3000
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server.mjs";

const baseUrl = process.env.EXCALIDRAW_URL || "http://localhost:3000";
await createServer({ baseUrl }).connect(new StdioServerTransport());
