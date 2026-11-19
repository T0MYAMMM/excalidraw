import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import { vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { appJotaiStore } from "../app-jotai";

import * as api from "./api";
import { currentDrawingAtom, drawingSession, saveStatusAtom } from "./session";

vi.mock("./api", () => ({
  listDrawings: vi.fn(async () => []),
  readDrawing: vi.fn(),
  createDrawing: vi.fn(async (name: string) => ({ name })),
  writeDrawing: vi.fn(async (name: string) => ({ name })),
  renameDrawing: vi.fn(async (_: string, newName: string) => ({
    name: newName,
  })),
  deleteDrawing: vi.fn(async () => undefined),
}));

const emptyFile = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [],
  appState: {},
  files: {},
});

/** Minimal stand-in for the editor: a mutable scene plus spies. */
const createFakeEditor = () => {
  const state = {
    elements: [] as any[],
    appState: { ...getDefaultAppState(), width: 800, height: 600 } as any,
  };
  const editor = {
    state,
    getSceneElements: () => state.elements,
    getAppState: () => state.appState,
    getFiles: () => ({}),
    addFiles: vi.fn(),
    updateScene: vi.fn((scene: any) => {
      if (scene.elements) {
        state.elements = scene.elements;
      }
      if (scene.appState) {
        state.appState = { ...state.appState, ...scene.appState };
      }
    }),
    history: { clear: vi.fn() },
    setViewport: vi.fn(),
    resetScene: vi.fn(() => {
      state.elements = [];
    }),
  };
  return editor;
};

const asAPI = (editor: ReturnType<typeof createFakeEditor>) =>
  editor as unknown as ExcalidrawImperativeAPI;

const rect = (id: string) => ({
  id,
  type: "rectangle",
  isDeleted: false,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
});

describe("drawingSession", () => {
  let editor: ReturnType<typeof createFakeEditor>;

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    appJotaiStore.set(currentDrawingAtom, null);
    editor = createFakeEditor();
    await drawingSession.start(asAPI(editor));
  });

  it("does nothing on change when no drawing is open", async () => {
    editor.state.elements = [rect("a")];
    drawingSession.onSceneChange();
    await drawingSession.save();
    expect(api.writeDrawing).not.toHaveBeenCalled();
    expect(drawingSession.hasUnfiledContent()).toBe(true);
  });

  it("opens a drawing and only writes when the content changed", async () => {
    vi.mocked(api.readDrawing).mockResolvedValue(emptyFile);
    await drawingSession.open("Plan");

    expect(appJotaiStore.get(currentDrawingAtom)).toBe("Plan");
    expect(localStorage.getItem("excalidraw-file-manager-current")).toBe(
      "Plan",
    );
    expect(editor.history.clear).toHaveBeenCalled();

    await drawingSession.save();
    expect(api.writeDrawing).not.toHaveBeenCalled();

    editor.state.elements = [rect("a")];
    expect(drawingSession.hasUnsavedChanges()).toBe(true);
    await drawingSession.save();
    expect(api.writeDrawing).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.writeDrawing).mock.calls[0][0]).toBe("Plan");
    expect(
      JSON.parse(vi.mocked(api.writeDrawing).mock.calls[0][1]).elements,
    ).toHaveLength(1);
    expect(drawingSession.hasUnsavedChanges()).toBe(false);
    expect(appJotaiStore.get(saveStatusAtom)).toBe("saved");
  });

  it("reopens the stored drawing on start", async () => {
    vi.mocked(api.readDrawing).mockResolvedValue(emptyFile);
    localStorage.setItem("excalidraw-file-manager-current", "Kept");
    await drawingSession.start(asAPI(editor));
    expect(api.readDrawing).toHaveBeenCalledWith("Kept");
    expect(appJotaiStore.get(currentDrawingAtom)).toBe("Kept");
  });

  it("forgets a stored drawing the server no longer has", async () => {
    vi.mocked(api.readDrawing).mockRejectedValue(new Error("not found"));
    localStorage.setItem("excalidraw-file-manager-current", "Gone");
    await drawingSession.start(asAPI(editor));
    expect(appJotaiStore.get(currentDrawingAtom)).toBeNull();
    expect(localStorage.getItem("excalidraw-file-manager-current")).toBeNull();
    expect(appJotaiStore.get(saveStatusAtom)).toBe("error");
  });

  it("marks a failed save as an error and keeps the changes pending", async () => {
    vi.mocked(api.readDrawing).mockResolvedValue(emptyFile);
    await drawingSession.open("Plan");
    vi.mocked(api.writeDrawing).mockRejectedValueOnce(new Error("offline"));
    editor.state.elements = [rect("a")];
    await drawingSession.save();
    expect(appJotaiStore.get(saveStatusAtom)).toBe("error");
    expect(drawingSession.hasUnsavedChanges()).toBe(true);
  });

  it("saves an unfiled canvas as a new drawing", async () => {
    editor.state.elements = [rect("a")];
    await drawingSession.saveCanvasAsNew();
    const [name, content] = vi.mocked(api.createDrawing).mock.calls[0];
    expect(name).toMatch(/^Drawing \d{4}-\d{2}-\d{2} \d{2}\.\d{2}$/);
    expect(JSON.parse(content!).elements).toHaveLength(1);
    expect(appJotaiStore.get(currentDrawingAtom)).toBe(name);
  });

  it("follows a rename of the open drawing", async () => {
    vi.mocked(api.readDrawing).mockResolvedValue(emptyFile);
    await drawingSession.open("Old");
    await drawingSession.rename("Old", "New");
    expect(appJotaiStore.get(currentDrawingAtom)).toBe("New");
    expect(editor.state.appState.name).toBe("New");
  });

  it("clears the canvas when the open drawing is deleted", async () => {
    vi.mocked(api.readDrawing).mockResolvedValue(emptyFile);
    await drawingSession.open("Plan");
    await drawingSession.remove("Plan");
    expect(api.deleteDrawing).toHaveBeenCalledWith("Plan");
    expect(editor.resetScene).toHaveBeenCalled();
    expect(appJotaiStore.get(currentDrawingAtom)).toBeNull();
  });
});
