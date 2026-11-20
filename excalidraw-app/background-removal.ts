/**
 * Background removal through the local rembg container (see
 * docker-compose.yml), reached via nginx at /api/rembg/.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const ENDPOINT = "/api/rembg/api/remove";
/**
 * IS-Net general (Apache-2.0): ~1.3 s and <2 GB RAM per image on CPU here.
 * BiRefNet gives cleaner edges but needed 7-10 GB and crashed under WSL.
 */
export const REMBG_MODEL = "isnet-general-use";
const TIMEOUT_MS = 5 * 60 * 1000;

/** Sends the image to rembg and returns the cut-out PNG. */
export const requestBackgroundRemoval = async (
  image: Blob,
  fetchImpl: typeof fetch = fetch,
): Promise<Blob> => {
  const form = new FormData();
  form.append("file", image, "image");
  form.append("model", REMBG_MODEL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(
        res.status === 502 || res.status === 504
          ? "the background removal service isn't running"
          : `background removal failed (${res.status})`,
      );
    }
    const type = res.headers.get("Content-Type") ?? "";
    if (!type.startsWith("image/")) {
      throw new Error(
        "background removal returned something that isn't an image",
      );
    }
    return new Blob([await res.arrayBuffer()], { type });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("background removal took too long");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * `onRemoveImageBackground` for the editor: shows progress and errors as
 * toasts around requestBackgroundRemoval.
 */
export const removeImageBackground = async (
  image: Blob,
  api: ExcalidrawImperativeAPI | null,
): Promise<Blob> => {
  api?.setToast({
    message:
      "Removing background… (the first time takes a minute or two while the model downloads)",
    duration: Infinity,
  });
  try {
    const result = await requestBackgroundRemoval(image);
    api?.setToast(null);
    return result;
  } catch (error) {
    api?.setToast({
      message: `Couldn't remove the background: ${
        error instanceof Error ? error.message : String(error)
      }`,
      closable: true,
      duration: Infinity,
    });
    throw error;
  }
};
