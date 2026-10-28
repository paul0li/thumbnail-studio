// What opening a thumbnail means, given what the server has and what this
// device kept. Pure, so every case is a test.

import type { ThumbnailState } from "./api";
import type { DesignDocument } from "./document/types";
import { validateDocument } from "./document/validate";
import type { Entry, Opened } from "./store";
import type { LocalCopy, SyncStatus } from "./sync";

export interface Start {
  opened: Opened;
  /** How saving starts out for it. */
  status: SyncStatus;
}

function valid(doc: unknown): DesignDocument | null {
  const result = validateDocument(doc);
  return result.ok ? result.document : null;
}

/** The server's thumbnail with its undo history, oldest first. */
export function fromServer(state: ThumbnailState): Opened | null {
  const doc = valid(state.document);
  if (!doc) return null;
  const history: Entry[] = [];
  for (const saved of state.history) {
    const old = valid(saved.document);
    if (old) history.push({ doc: old, version: saved.version });
  }
  return { id: state.id, head: state.version, current: { doc, version: state.version }, history };
}

/**
 * - The server's version, if this device has nothing unsaved for it.
 * - This device's unsaved change on top of it, if it was made on that same
 *   version (it is then saved).
 * - This device's change with a conflict, if the server moved on meanwhile:
 *   the host chooses, nothing is overwritten.
 * - This device's copy alone, if the server cannot be reached or never got it.
 */
export function reconcile(id: string, server: ThumbnailState | null | "offline", local: LocalCopy | null): Start | null {
  const mine = local && local.id === id ? local : null;
  if (server === "offline") {
    if (!mine) return null;
    return {
      opened: { id, head: mine.head, current: { doc: mine.doc, version: mine.unsaved ? null : mine.head }, history: [], parent: mine.unsaved ? mine.parent : null },
      status: { kind: "offline" },
    };
  }
  if (server === null) {
    // Never reached the server (made offline): it is created now.
    if (mine && mine.unsaved && mine.head === 0) {
      return { opened: { id, head: 0, current: { doc: mine.doc, version: null }, history: [] }, status: { kind: "saving" } };
    }
    return null;
  }
  const opened = fromServer(server);
  if (!opened) return null;
  if (!mine || !mine.unsaved) return { opened, status: { kind: "saved" } };
  if (mine.head === server.version) {
    return {
      opened: { ...opened, current: { doc: mine.doc, version: null }, history: [...opened.history, opened.current] },
      status: { kind: "saving" },
    };
  }
  return {
    opened: { id, head: mine.head, current: { doc: mine.doc, version: null }, history: [], parent: mine.parent },
    status: { kind: "conflict", version: server.version },
  };
}
