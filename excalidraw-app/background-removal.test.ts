import { vi } from "vitest";

import { REMBG_MODEL, requestBackgroundRemoval } from "./background-removal";

const png = () => new Blob(["png-bytes"], { type: "image/png" });

describe("requestBackgroundRemoval", () => {
  it("posts the image and model to rembg and returns the cut-out", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(png(), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
    );
    const result = await requestBackgroundRemoval(png(), fetchMock as any);

    expect(result.type).toBe("image/png");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/rembg/api/remove");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("model")).toBe(REMBG_MODEL);
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("explains when the service isn't running", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 502 }));
    await expect(
      requestBackgroundRemoval(png(), fetchMock as any),
    ).rejects.toThrow("isn't running");
  });

  it("rejects a response that isn't an image", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    await expect(
      requestBackgroundRemoval(png(), fetchMock as any),
    ).rejects.toThrow("isn't an image");
  });
});
