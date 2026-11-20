import {
  CaptureUpdateAction,
  isImageElement,
  newElementWith,
} from "@excalidraw/element";
import { MIME_TYPES } from "@excalidraw/common";

import type { ExcalidrawImageElement } from "@excalidraw/element/types";

import { dataURLToFile, generateIdFromFile, getDataURL } from "../data/blob";
import { EraserIcon } from "../components/icons";

import { register } from "./register";

import type { BinaryFiles } from "../types";

/**
 * Replaces the selected image with a copy whose background was removed by
 * the host app (`onRemoveImageBackground` prop). Shown only when the host
 * provides that prop and exactly one loaded image is selected. Undo brings
 * the original image back.
 *
 * Progress and error messages are the host's job: the callback runs for a
 * few seconds and may fail (e.g. its service is down).
 */
export const actionRemoveImageBackground = register({
  name: "removeImageBackground",
  label: "labels.removeImageBackground",
  icon: EraserIcon,
  trackEvent: { category: "element" },
  keywords: ["image", "background", "remove", "cutout", "transparent"],
  predicate: (elements, appState, appProps, app) => {
    if (!appProps.onRemoveImageBackground) {
      return false;
    }
    const selected = app.scene.getSelectedElements(appState);
    return (
      selected.length === 1 &&
      isImageElement(selected[0]) &&
      !!selected[0].fileId &&
      !!app.files[selected[0].fileId]
    );
  },
  perform: async (elements, appState, _, app) => {
    const removeBackground = app.props.onRemoveImageBackground;
    const image = app.scene.getSelectedElements(appState)[0] as
      | ExcalidrawImageElement
      | undefined;
    const original = image?.fileId ? app.files[image.fileId] : undefined;
    if (!removeBackground || !image || !original) {
      return false;
    }

    let cutout: Blob;
    try {
      cutout = await removeBackground(dataURLToFile(original.dataURL));
    } catch {
      return false; // the host reported the error
    }

    const file = new File([cutout], "cutout.png", { type: MIME_TYPES.png });
    const fileId = await generateIdFromFile(file);
    const files: BinaryFiles = {
      [fileId]: {
        id: fileId,
        mimeType: MIME_TYPES.png,
        dataURL: await getDataURL(file),
        created: Date.now(),
      },
    };

    // the scene may have changed while the background was being removed
    const current = app.scene.getElementsIncludingDeleted();
    if (!current.some((el) => el.id === image.id && !el.isDeleted)) {
      return false;
    }
    return {
      elements: current.map((el) =>
        el.id === image.id
          ? newElementWith(el as ExcalidrawImageElement, {
              fileId,
              status: "pending",
            })
          : el,
      ),
      files,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
});
