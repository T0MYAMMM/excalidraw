import React from "react";
import { vi } from "vitest";

import { MIME_TYPES, reseed } from "@excalidraw/common";
import { CaptureUpdateAction } from "@excalidraw/element";

import type { DataURL } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, UI } from "./helpers/ui";
import {
  GlobalTestState,
  act,
  fireEvent,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  unmountComponent,
  waitFor,
} from "./test-utils";

const { h } = window;

// 1x1 transparent PNG
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" as DataURL;

const ORIGINAL_FILE_ID = "original-file" as FileId;

unmountComponent();

const addImage = () => {
  act(() => {
    h.app.addFiles([
      {
        id: ORIGINAL_FILE_ID,
        mimeType: MIME_TYPES.png,
        dataURL: PNG_DATA_URL,
        created: 1,
      },
    ]);
  });
  const image = API.createElement({
    type: "image",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fileId: ORIGINAL_FILE_ID,
  });
  // like a paste or a loaded drawing: the store knows the image is there
  act(() => {
    h.app.updateScene({
      elements: [image],
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  });
  API.setSelectedElements([image]);
  return image;
};

const openContextMenu = () => {
  fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
    button: 2,
    clientX: 50,
    clientY: 50,
  });
  return UI.queryContextMenu();
};

const menuItemNames = (menu: HTMLElement | null) =>
  [...(menu?.querySelectorAll(".context-menu li[data-testid]") ?? [])].map(
    (li) => li.getAttribute("data-testid"),
  );

describe("remove image background", () => {
  beforeAll(() => {
    mockBoundingClientRect();
  });

  afterAll(() => {
    restoreOriginalGetBoundingClientRect();
  });

  beforeEach(() => {
    localStorage.clear();
    reseed(7);
  });

  it("is listed right after 'Flip vertical' for a selected image", async () => {
    await render(
      <Excalidraw onRemoveImageBackground={async (blob: Blob) => blob} />,
    );
    addImage();
    const names = menuItemNames(openContextMenu());
    const flip = names.indexOf("flipVertical");
    expect(flip).toBeGreaterThan(-1);
    expect(names[flip + 1]).toBe("removeImageBackground");
  });

  it("isn't listed without the host callback", async () => {
    await render(<Excalidraw />);
    addImage();
    expect(menuItemNames(openContextMenu())).not.toContain(
      "removeImageBackground",
    );
  });

  it("isn't listed for non-image elements", async () => {
    await render(
      <Excalidraw onRemoveImageBackground={async (blob: Blob) => blob} />,
    );
    const rect = API.createElement({ type: "rectangle", width: 100 });
    API.setElements([rect]);
    API.setSelectedElements([rect]);
    expect(menuItemNames(openContextMenu())).not.toContain(
      "removeImageBackground",
    );
  });

  it("swaps in the cut-out image, and undo restores the original", async () => {
    const cutout = new Blob(["cut-out"], { type: "image/png" });
    const onRemove = vi.fn(async () => cutout);
    await render(
      <Excalidraw
        handleKeyboardGlobally={true}
        onRemoveImageBackground={onRemove}
      />,
    );
    const image = addImage();

    const menu = openContextMenu();
    fireEvent.click(
      menu!.querySelector('li[data-testid="removeImageBackground"]')!,
    );

    await waitFor(() => {
      expect(h.elements[0].id).toBe(image.id);
      expect((h.elements[0] as any).fileId).not.toBe(ORIGINAL_FILE_ID);
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect((onRemove.mock.calls[0] as unknown as [Blob])[0]).toBeInstanceOf(
      Blob,
    );
    const newFileId = (h.elements[0] as any).fileId as FileId;
    expect(h.app.files[newFileId].mimeType).toBe(MIME_TYPES.png);
    // the original stays available for undo
    expect(h.app.files[ORIGINAL_FILE_ID]).toBeDefined();

    Keyboard.undo();
    expect((h.elements[0] as any).fileId).toBe(ORIGINAL_FILE_ID);
  });

  it("leaves the image unchanged when the host fails", async () => {
    const onRemove = vi.fn(async () => {
      throw new Error("service down");
    });
    await render(<Excalidraw onRemoveImageBackground={onRemove} />);
    addImage();

    const menu = openContextMenu();
    fireEvent.click(
      menu!.querySelector('li[data-testid="removeImageBackground"]')!,
    );
    await waitFor(() => expect(onRemove).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect((h.elements[0] as any).fileId).toBe(ORIGINAL_FILE_ID);
  });
});
