/**
 * Talks to the file-server API (through the Excalidraw container's nginx,
 * or directly) and applies scene edits with optimistic locking.
 */

/** Error with the HTTP status from the file-server. */
export class FilesApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MAX_ATTEMPTS = 3;

export const createClient = (baseUrl) => {
  const root = `${baseUrl.replace(/\/$/, "")}/api/files`;
  const urlFor = (name) => `${root}/${encodeURIComponent(name)}`;

  const request = async (url, init) => {
    let res;
    try {
      res = await fetch(url, init);
    } catch (error) {
      throw new FilesApiError(
        0,
        `can't reach the Excalidraw file server at ${baseUrl} (${error.message}). Is the container running?`,
      );
    }
    if (!res.ok) {
      let message = `request failed (${res.status})`;
      try {
        message = (await res.json()).error ?? message;
      } catch {
        // not JSON
      }
      throw new FilesApiError(res.status, message);
    }
    return res;
  };

  const list = async () => (await request(root)).json();

  /** { scene, version } of a drawing. */
  const read = async (name) => {
    const res = await request(urlFor(name));
    const version = (res.headers.get("etag") ?? "").replace(/"/g, "");
    return { scene: JSON.parse(await res.text()), version };
  };

  const create = async (name, scene) =>
    (
      await request(root, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content: JSON.stringify(scene, null, 2) }),
      })
    ).json();

  const write = async (name, scene, version) =>
    (
      await request(urlFor(name), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": `"${version}"`,
        },
        body: JSON.stringify(scene, null, 2),
      })
    ).json();

  /**
   * Reads a drawing, lets `edit(scene)` change it, and writes it back only if
   * nobody changed the file meanwhile; otherwise re-reads and re-applies.
   * Returns whatever `edit` returned.
   */
  const modify = async (name, edit) => {
    for (let attempt = 1; ; attempt++) {
      const { scene, version } = await read(name);
      const result = edit(scene);
      try {
        await write(name, scene, version);
        return result;
      } catch (error) {
        if (error.status !== 412 || attempt >= MAX_ATTEMPTS) {
          throw error;
        }
      }
    }
  };

  return { list, read, create, modify };
};

/** A new, empty scene in the .excalidraw file format. */
export const emptyScene = () => ({
  type: "excalidraw",
  version: 2,
  source: "excalidraw-files-mcp",
  elements: [],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});
