/**
 * Client for the file-server API (see /file-server/server.mjs), reached
 * through nginx at /api/files.
 */

export type DrawingInfo = {
  name: string;
  size: number;
  updatedAt: string;
};

/** A drawing's file content plus its version (a content hash). */
export type DrawingContent = {
  content: string;
  version: string;
};

const BASE = "/api/files";

/** Error carrying the HTTP status and the server's message. */
export class FileApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** On 412: the version the file has now. */
    public version?: string,
  ) {
    super(message);
  }
}

const urlFor = (name: string) => `${BASE}/${encodeURIComponent(name)}`;

const request = async (url: string, init?: RequestInit): Promise<Response> => {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok && res.status !== 304) {
    let message = `request failed (${res.status})`;
    let version: string | undefined;
    try {
      const body = await res.json();
      message = body.error ?? message;
      version = body.version;
    } catch {
      // body wasn't JSON; keep the generic message
    }
    throw new FileApiError(res.status, message, version);
  }
  return res;
};

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const listDrawings = async (): Promise<DrawingInfo[]> =>
  (await request(BASE)).json();

const versionFrom = (res: Response) =>
  (res.headers.get("ETag") ?? "").replace(/^W\//, "").replace(/"/g, "");

export const readDrawing = async (name: string): Promise<DrawingContent> => {
  const res = await request(urlFor(name));
  return { content: await res.text(), version: versionFrom(res) };
};

/** Like readDrawing, but null when the file still has `version`. */
export const readDrawingIfChanged = async (
  name: string,
  version: string,
): Promise<DrawingContent | null> => {
  const res = await request(urlFor(name), {
    headers: { "If-None-Match": `"${version}"` },
  });
  if (res.status === 304) {
    return null;
  }
  return { content: await res.text(), version: versionFrom(res) };
};

export const createDrawing = async (
  name: string,
  content?: string,
): Promise<DrawingInfo & { version: string }> =>
  (await request(BASE, jsonInit("POST", { name, content }))).json();

/**
 * Overwrites a drawing. With `baseVersion`, the server refuses (412) if the
 * file changed since that version.
 */
export const writeDrawing = async (
  name: string,
  content: string,
  baseVersion?: string | null,
): Promise<DrawingInfo & { version: string }> =>
  (
    await request(urlFor(name), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(baseVersion ? { "If-Match": `"${baseVersion}"` } : {}),
      },
      body: content,
    })
  ).json();

export const renameDrawing = async (
  name: string,
  newName: string,
): Promise<DrawingInfo> =>
  (await request(urlFor(name), jsonInit("PATCH", { newName }))).json();

export const deleteDrawing = async (name: string): Promise<void> => {
  await request(urlFor(name), { method: "DELETE" });
};
