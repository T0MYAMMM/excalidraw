/**
 * Client for the file-server API (see /file-server/server.mjs), reached
 * through nginx at /api/files.
 */

export type DrawingInfo = {
  name: string;
  size: number;
  updatedAt: string;
};

const BASE = "/api/files";

/** Error carrying the HTTP status and the server's message. */
export class FileApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const urlFor = (name: string) => `${BASE}/${encodeURIComponent(name)}`;

const request = async (url: string, init?: RequestInit): Promise<Response> => {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) {
    let message = `request failed (${res.status})`;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      // body wasn't JSON; keep the generic message
    }
    throw new FileApiError(res.status, message);
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

export const readDrawing = async (name: string): Promise<string> =>
  (await request(urlFor(name))).text();

export const createDrawing = async (
  name: string,
  content?: string,
): Promise<DrawingInfo> =>
  (await request(BASE, jsonInit("POST", { name, content }))).json();

export const writeDrawing = async (
  name: string,
  content: string,
): Promise<DrawingInfo> =>
  (
    await request(urlFor(name), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
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
