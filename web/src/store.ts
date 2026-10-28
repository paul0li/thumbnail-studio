// The editor's state: which thumbnail is open, its document, what is selected,
// and the undo history. Every change goes through `commit`, which validates the
// document first: an invalid document is never drawn or saved.
//
// Each state in the history remembers the server version it was saved as, if
// it was. That is what lets a save say which version is one undo step back
// (ADR 0009), and what lets the history be rebuilt from the server after a
// reload.

import type { Selection } from "./canvas/scene";
import { newDocument } from "./document/edit";
import type { DesignDocument } from "./document/types";
import { validateDocument } from "./document/validate";

export const HISTORY_LIMIT = 60;

export interface Entry {
  doc: DesignDocument;
  /** The server version this state was saved as; null until it is. */
  version: number | null;
}

export interface Opened {
  id: string;
  /** The server's version of this thumbnail; 0 if it does not exist there yet. */
  head: number;
  current: Entry;
  history: Entry[];
  /** The saved version one undo step back, when the history itself is not
   *  here (opened from this device's copy while the server was away). */
  parent?: number | null;
}

export interface CommitOptions {
  /** Consecutive commits with the same key are one undo step (a slider drag). */
  key?: string;
  /** Redraw the canvas but not the panels (the control being used stays put). */
  quiet?: boolean;
}

type Listener = (quiet: boolean) => void;

export class Store {
  id = "";
  /** The version the server has as this thumbnail's head, as last confirmed. */
  head = 0;
  private current: Entry = { doc: newDocument(), version: null };
  private history: Entry[] = [];
  private parentHint: number | null = null;
  selection: Selection = null;
  private lastKey: string | undefined;
  private listeners: Listener[] = [];

  get doc(): DesignDocument {
    return this.current.doc;
  }

  /** The version the document on screen was saved as, or null. */
  get version(): number | null {
    return this.current.version;
  }

  subscribe(listener: Listener): void {
    this.listeners.push(listener);
  }

  private notify(quiet: boolean): void {
    for (const l of this.listeners) l(quiet);
  }

  /** Returns the validation errors, empty if the change was applied. */
  commit(next: DesignDocument, options: CommitOptions = {}): string[] {
    if (next === this.doc) return [];
    const result = validateDocument(next);
    if (!result.ok) {
      console.error("rejected document", result.errors);
      return result.errors;
    }
    if (!options.key || options.key !== this.lastKey) {
      this.history.push(this.current);
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
    }
    this.lastKey = options.key;
    this.current = { doc: next, version: null };
    this.dropStaleSelection();
    this.notify(options.quiet ?? false);
    return [];
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.lastKey = undefined;
    this.current = previous;
    this.dropStaleSelection();
    this.notify(false);
  }

  select(selection: Selection): void {
    this.selection = selection;
    this.lastKey = undefined;
    this.notify(false);
  }

  /** Opens a thumbnail: its document, and the undo history it comes with. */
  open(opened: Opened): void {
    this.id = opened.id;
    this.head = opened.head;
    this.current = opened.current;
    this.history = opened.history.slice(-HISTORY_LIMIT);
    this.parentHint = opened.parent ?? null;
    this.lastKey = undefined;
    this.selection = null;
    this.notify(false);
  }

  /** Whether what is on screen is not yet the server's head. */
  dirty(): boolean {
    return this.current.version === null || this.current.version !== this.head;
  }

  /** The saved version one undo step back from what is on screen: the nearest
   *  saved state below it in the history. */
  parentVersion(): number | null {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const version = this.history[i]!.version;
      if (version !== null) return version;
    }
    return this.parentHint;
  }

  /** The server stored `doc` as `version`. Marks the state that holds it,
   *  whether it is still on screen or already in the history. */
  saved(doc: DesignDocument, version: number): void {
    this.head = version;
    if (this.current.doc === doc) this.current = { doc, version };
    else {
      const i = this.history.findIndex((e) => e.doc === doc);
      if (i >= 0) this.history[i] = { doc, version };
    }
  }

  /** The thumbnail changed elsewhere and the host chose to keep this one:
   *  the next save goes on top of the server's version. */
  rebase(head: number): void {
    this.head = head;
  }

  private dropStaleSelection(): void {
    if (this.selection && !this.doc.layers.some((l) => l.id === this.selection?.layerId)) this.selection = null;
  }
}
