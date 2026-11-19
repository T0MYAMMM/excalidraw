import { useEffect, useRef, useState } from "react";

import { useExcalidrawAPI } from "@excalidraw/excalidraw";
import {
  DuplicateIcon,
  PlusIcon,
  TrashIcon,
  downloadIcon,
  pencilIcon,
} from "@excalidraw/excalidraw/components/icons";

import { useAtomValue } from "../app-jotai";

import { listDrawings } from "./api";
import { relativeTime } from "./naming";
import {
  currentDrawingAtom,
  drawingSession,
  drawingsVersionAtom,
  saveStatusAtom,
} from "./session";

import "./FilesPanel.scss";

import type { DrawingInfo } from "./api";
import type { SaveStatus } from "./session";

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Not saved: server unreachable",
};

const LIST_REFRESH_MS = 5000;

const UNFILED_WARNING =
  "The current drawing isn't saved to a file and will be replaced. Continue?";

/** Sidebar tab listing drawings stored by the file-server. */
export const FilesPanel = () => {
  const api = useExcalidrawAPI();
  const current = useAtomValue(currentDrawingAtom);
  const status = useAtomValue(saveStatusAtom);
  const version = useAtomValue(drawingsVersionAtom);
  const [drawings, setDrawings] = useState<DrawingInfo[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      listDrawings()
        .then((list) => {
          if (!cancelled) {
            setDrawings(list);
            setLoadError(false);
          }
        })
        .catch(() => !cancelled && setLoadError(true));
    refresh();
    // also picks up drawings created outside the app (e.g. by the MCP server)
    const interval = setInterval(refresh, LIST_REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [version]);

  /** Runs an action and shows its error as a toast instead of failing silently. */
  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      api?.setToast({
        message: error instanceof Error ? error.message : String(error),
        closable: true,
      });
    }
  };

  const okToReplaceCanvas = () =>
    !drawingSession.hasUnfiledContent() || window.confirm(UNFILED_WARNING);

  const open = (name: string) => {
    if (name !== current && okToReplaceCanvas()) {
      run(() => drawingSession.open(name));
    }
  };

  const remove = (name: string) => {
    if (window.confirm(`Move "${name}" to the trash folder?`)) {
      run(() => drawingSession.remove(name));
    }
  };

  return (
    <div className="files-panel">
      <div className="files-panel__current">
        {current ? (
          <>
            <div className="files-panel__current-name" title={current}>
              {current}
            </div>
            <div
              className={`files-panel__status files-panel__status--${status}`}
            >
              {STATUS_LABEL[status]}
            </div>
          </>
        ) : (
          <>
            <div className="files-panel__hint">
              This canvas isn't saved to a file.
            </div>
            <button
              type="button"
              className="files-panel__button"
              onClick={() => run(() => drawingSession.saveCanvasAsNew())}
            >
              Save as new drawing
            </button>
          </>
        )}
      </div>

      <button
        type="button"
        className="files-panel__button files-panel__button--primary"
        onClick={() =>
          okToReplaceCanvas() && run(() => drawingSession.createNew())
        }
      >
        {PlusIcon} New drawing
      </button>

      {loadError && (
        <div className="files-panel__hint files-panel__hint--error">
          Can't reach the file server.
        </div>
      )}
      {drawings?.length === 0 && (
        <div className="files-panel__hint">No drawings yet.</div>
      )}

      <ul className="files-panel__list">
        {drawings?.map((drawing) => (
          <li
            key={drawing.name}
            className={`files-panel__item ${
              drawing.name === current ? "files-panel__item--current" : ""
            }`}
          >
            {renaming === drawing.name ? (
              <RenameInput
                initial={drawing.name}
                onDone={(newName) => {
                  setRenaming(null);
                  if (newName && newName !== drawing.name) {
                    run(() => drawingSession.rename(drawing.name, newName));
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="files-panel__open"
                onClick={() => open(drawing.name)}
                title={`Open ${drawing.name}`}
              >
                <span className="files-panel__name">{drawing.name}</span>
                <span className="files-panel__time">
                  {relativeTime(drawing.updatedAt)}
                </span>
              </button>
            )}
            <div className="files-panel__actions">
              <IconButton
                title="Rename"
                icon={pencilIcon}
                onClick={() => setRenaming(drawing.name)}
              />
              <IconButton
                title="Duplicate"
                icon={DuplicateIcon}
                onClick={() =>
                  run(() => drawingSession.duplicate(drawing.name))
                }
              />
              <IconButton
                title="Download .excalidraw"
                icon={downloadIcon}
                onClick={() => run(() => drawingSession.download(drawing.name))}
              />
              <IconButton
                title="Delete"
                icon={TrashIcon}
                onClick={() => remove(drawing.name)}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

const IconButton = (props: {
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
}) => (
  <button
    type="button"
    className="files-panel__icon-button"
    title={props.title}
    aria-label={props.title}
    onClick={props.onClick}
  >
    {props.icon}
  </button>
);

/** Inline name editor: Enter saves, Escape or blur cancels. */
const RenameInput = (props: {
  initial: string;
  onDone: (name: string | null) => void;
}) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="files-panel__rename"
      defaultValue={props.initial}
      autoFocus
      onKeyDown={(event) => {
        // keep editor shortcuts (e.g. Delete) away from the canvas
        event.stopPropagation();
        if (event.key === "Enter") {
          props.onDone(event.currentTarget.value.trim());
        } else if (event.key === "Escape") {
          props.onDone(null);
        }
      }}
      onBlur={() => props.onDone(null)}
    />
  );
};
