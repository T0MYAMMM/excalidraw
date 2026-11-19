/**
 * The drawing that is open in the editor, and keeping it saved.
 *
 * - The open drawing's name is kept in localStorage, so a reload (or another
 *   tab, via the app's tab sync) reopens the same drawing.
 * - Changes are written to the server a moment after editing stops.
 * - Every write says which version it's based on. If the file changed on
 *   disk meanwhile (e.g. an AI agent edited it through the MCP server), the
 *   browser's edits are kept as a "(conflict …)" copy and the newer file is
 *   loaded, so nobody's work is overwritten.
 * - While nothing is pending, the open drawing is checked every few seconds
 *   and reloaded when it changed on disk.
 * - With no drawing open the canvas behaves like stock Excalidraw (kept only
 *   in the browser) until it's saved as a file.
 */
import { CaptureUpdateAction, serializeAsJSON } from "@excalidraw/excalidraw";
import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";
import { MIME_TYPES } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { appJotaiStore, atom } from "../app-jotai";

import {
  FileApiError,
  createDrawing,
  deleteDrawing,
  listDrawings,
  readDrawing,
  readDrawingIfChanged,
  renameDrawing,
  writeDrawing,
} from "./api";
import { defaultDrawingName, uniqueName } from "./naming";

import type { DrawingContent } from "./api";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

const CURRENT_KEY = "excalidraw-file-manager-current";
const SAVE_DELAY_MS = 800;
export const CHECK_INTERVAL_MS = 2000;

/** Name of the open drawing, or null when the canvas isn't a file. */
export const currentDrawingAtom = atom<string | null>(null);
export const saveStatusAtom = atom<SaveStatus>("idle");
/** Bumped after anything that changes the list, so the panel refetches. */
export const drawingsVersionAtom = atom(0);

const readStoredCurrent = (): string | null => {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
};

const storeCurrent = (name: string | null) => {
  try {
    if (name) {
      localStorage.setItem(CURRENT_KEY, name);
    } else {
      localStorage.removeItem(CURRENT_KEY);
    }
  } catch {
    // storage blocked: the drawing still works, it just isn't reopened
  }
};

class DrawingSession {
  private api: ExcalidrawImperativeAPI | null = null;
  /** Serialized content last written to (or read from) the server. */
  private lastSaved: string | null = null;
  /** Server version that `lastSaved` corresponds to. */
  private baseVersion: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  /** Saves and disk checks run one after another through this chain. */
  private queue: Promise<void> = Promise.resolve();

  get current(): string | null {
    return appJotaiStore.get(currentDrawingAtom);
  }

  private setCurrent(name: string | null) {
    storeCurrent(name);
    appJotaiStore.set(currentDrawingAtom, name);
  }

  private setStatus(status: SaveStatus) {
    appJotaiStore.set(saveStatusAtom, status);
  }

  private bumpList() {
    appJotaiStore.set(drawingsVersionAtom, (v) => v + 1);
  }

  private requireAPI(): ExcalidrawImperativeAPI {
    if (!this.api) {
      throw new Error("editor isn't ready yet");
    }
    return this.api;
  }

  private serialize(): string {
    const api = this.requireAPI();
    return serializeAsJSON(
      api.getSceneElements(),
      api.getAppState(),
      api.getFiles(),
      "local",
    );
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task, task);
    return this.queue;
  }

  private cancelPendingSave() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Called once the editor and its initial (browser-stored) scene exist. */
  async start(api: ExcalidrawImperativeAPI): Promise<void> {
    this.api = api;
    this.startChecking();
    const stored = readStoredCurrent();
    if (!stored) {
      return;
    }
    try {
      await this.load(stored, await readDrawing(stored));
    } catch (error) {
      // file gone (deleted/renamed outside the app) or server down: keep
      // what the browser had, but don't autosave it anywhere
      console.warn(`file-manager: couldn't reopen "${stored}"`, error);
      this.setCurrent(null);
      this.baseVersion = null;
      this.setStatus("error");
    }
  }

  /** Stops the periodic disk check (used by tests). */
  stop(): void {
    this.cancelPendingSave();
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  private startChecking() {
    if (this.checkTimer) {
      return;
    }
    this.checkTimer = setInterval(() => {
      if (document.visibilityState === "visible") {
        this.checkForChanges();
      }
    }, CHECK_INTERVAL_MS);
  }

  /**
   * Puts a drawing's content on the canvas and makes it the open one.
   * `refresh` keeps the user's viewport (same drawing, updated on disk).
   */
  private async load(
    name: string,
    { content, version }: DrawingContent,
    { refresh = false } = {},
  ): Promise<void> {
    const api = this.requireAPI();
    const scene = await loadFromBlob(
      new Blob([content], { type: MIME_TYPES.excalidraw }),
      api.getAppState(),
      null,
    );
    const viewport = refresh
      ? (({ scrollX, scrollY, zoom }) => ({ scrollX, scrollY, zoom }))(
          api.getAppState(),
        )
      : {};
    api.addFiles(Object.values(scene.files));
    api.updateScene({
      elements: scene.elements,
      appState: {
        ...scene.appState,
        ...viewport,
        name,
        selectedElementIds: {},
        selectedGroupIds: {},
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    api.history.clear();
    this.setCurrent(name);
    this.lastSaved = this.serialize();
    this.baseVersion = version;
    this.setStatus("saved");

    const elements = api.getSceneElements();
    if (!refresh && elements.length) {
      api.setViewport({
        target: elements,
        fit: "scale-down",
        animation: false,
      });
    }
  }

  /** Editor onChange hook: schedules a save if a drawing is open. */
  onSceneChange(): void {
    if (!this.current || !this.api) {
      return;
    }
    this.cancelPendingSave();
    this.timer = setTimeout(() => {
      this.save();
    }, SAVE_DELAY_MS);
  }

  /** Writes pending changes now. Safe to call any time. */
  save(): Promise<void> {
    this.cancelPendingSave();
    return this.enqueue(() => this.writeIfChanged());
  }

  private async writeIfChanged(): Promise<void> {
    const name = this.current;
    if (!name || !this.api) {
      return;
    }
    const content = this.serialize();
    if (content === this.lastSaved) {
      this.setStatus("saved");
      return;
    }
    this.setStatus("saving");
    try {
      if (!this.baseVersion) {
        // unknown base (e.g. after a tab sync): check the disk first
        await this.resolveConflict(name, content);
        return;
      }
      await this.write(name, content);
    } catch (error) {
      if (error instanceof FileApiError && error.status === 412) {
        await this.resolveConflict(name, content);
        return;
      }
      console.error("file-manager: save failed", error);
      this.setStatus("error");
    }
  }

  private async write(name: string, content: string): Promise<void> {
    const info = await writeDrawing(name, content, this.baseVersion);
    this.lastSaved = content;
    this.baseVersion = info.version;
    this.setStatus("saved");
    this.bumpList();
  }

  /**
   * The file changed on disk since our last read/write. If the disk still
   * holds what we last saved (e.g. another tab saved identical content),
   * just retry. Otherwise keep our edits as a conflict copy and load the
   * disk version.
   */
  private async resolveConflict(name: string, ours: string): Promise<void> {
    const theirs = await readDrawing(name);
    if (theirs.content === this.lastSaved) {
      this.baseVersion = theirs.version;
      await this.write(name, ours);
      return;
    }
    const copyName = await this.freeName(
      `${name} (conflict ${defaultDrawingName().replace("Drawing ", "")})`,
    );
    await createDrawing(copyName, ours);
    await this.load(name, theirs, { refresh: true });
    this.bumpList();
    this.api?.setToast({
      message: `"${name}" was changed elsewhere. Your edits were kept as "${copyName}".`,
      closable: true,
      duration: Infinity,
    });
  }

  /** Reloads the open drawing if it changed on disk and nothing is pending. */
  checkForChanges(): Promise<void> {
    return this.enqueue(async () => {
      const name = this.current;
      if (!name || !this.api || this.timer) {
        return;
      }
      try {
        const changed = await readDrawingIfChanged(
          name,
          this.baseVersion ?? "",
        );
        // the user may have edited or switched drawings while we waited
        if (
          !changed ||
          this.current !== name ||
          this.timer ||
          this.serialize() !== this.lastSaved
        ) {
          return;
        }
        if (changed.content === this.lastSaved) {
          this.baseVersion = changed.version;
          return;
        }
        await this.load(name, changed, { refresh: true });
        this.bumpList();
      } catch (error) {
        if (error instanceof FileApiError && error.status === 404) {
          // deleted or renamed outside the app: stop autosaving to it
          this.setCurrent(null);
          this.baseVersion = null;
          this.lastSaved = null;
          this.setStatus("idle");
          this.bumpList();
        }
      }
    });
  }

  /** True when closing the page now would lose edits. */
  hasUnsavedChanges(): boolean {
    if (!this.current || !this.api) {
      return false;
    }
    return this.timer !== null || this.serialize() !== this.lastSaved;
  }

  /** True when the canvas has content that isn't in any file. */
  hasUnfiledContent(): boolean {
    return (
      !this.current && !!this.api && this.api.getSceneElements().length > 0
    );
  }

  /** Another tab changed the shared scene (and maybe the open drawing). */
  onTabSync(): void {
    if (!this.api) {
      return;
    }
    this.cancelPendingSave();
    const name = readStoredCurrent();
    if (name !== this.current) {
      // the base version belongs to the old drawing; the next disk check
      // or save fetches the right one
      this.baseVersion = null;
    }
    appJotaiStore.set(currentDrawingAtom, name);
    // the other tab saved this content already
    this.lastSaved = name ? this.serialize() : null;
    this.setStatus(name ? "saved" : "idle");
  }

  async open(name: string): Promise<void> {
    await this.save();
    await this.load(name, await readDrawing(name));
  }

  private async freeName(base: string): Promise<string> {
    const taken = (await listDrawings()).map((d) => d.name);
    return uniqueName(base, taken);
  }

  /** Creates an empty drawing and opens it. */
  async createNew(): Promise<void> {
    await this.save();
    const { name } = await createDrawing(
      await this.freeName(defaultDrawingName()),
    );
    this.bumpList();
    await this.open(name);
  }

  /** Saves the current canvas (not yet in a file) as a new drawing. */
  async saveCanvasAsNew(): Promise<void> {
    const name = await this.freeName(defaultDrawingName());
    this.requireAPI().updateScene({
      appState: { name },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    const content = this.serialize();
    const info = await createDrawing(name, content);
    this.setCurrent(name);
    this.lastSaved = content;
    this.baseVersion = info.version;
    this.setStatus("saved");
    this.bumpList();
  }

  async rename(name: string, newName: string): Promise<void> {
    if (name === this.current) {
      await this.save();
    }
    const info = await renameDrawing(name, newName);
    if (name === this.current) {
      this.setCurrent(info.name);
      this.requireAPI().updateScene({
        appState: { name: info.name },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
    this.bumpList();
  }

  async duplicate(name: string): Promise<void> {
    if (name === this.current) {
      await this.save();
    }
    const { content } = await readDrawing(name);
    await createDrawing(await this.freeName(`${name} copy`), content);
    this.bumpList();
  }

  /** Moves a drawing to the server's trash; clears the canvas if it's open. */
  async remove(name: string): Promise<void> {
    if (name === this.current) {
      this.cancelPendingSave();
      await this.queue;
    }
    await deleteDrawing(name);
    if (name === this.current) {
      this.setCurrent(null);
      this.lastSaved = null;
      this.baseVersion = null;
      this.setStatus("idle");
      this.requireAPI().resetScene();
      this.requireAPI().history.clear();
    }
    this.bumpList();
  }

  /** Downloads the saved file as <name>.excalidraw. */
  async download(name: string): Promise<void> {
    if (name === this.current) {
      await this.save();
    }
    const { content } = await readDrawing(name);
    const url = URL.createObjectURL(
      new Blob([content], { type: MIME_TYPES.excalidraw }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}.excalidraw`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export const drawingSession = new DrawingSession();
