# Guidelines

> **This branch (`file-manager`) adds a local stack on top of upstream:** drawings stored as files, an MCP server, background removal, and agent tooling. Start with [LOCAL-STACK.md](LOCAL-STACK.md). The guidelines below are upstream's.

- For new DOM/browser API usage, use `app.ownerDocument` and `app.ownerWindow` instead of globals; without `app`, derive them from the mounted node's `ownerDocument` and its `defaultView`.
- When overriding properties of an existing type, prefer `Merge<Base, Overrides>` from `@excalidraw/common/utility-types` over `Omit<Base, keyof Overrides> & Overrides`.
