// The editor's state: the document, what is selected, and the undo history.
// Every change goes through `commit`, which validates the document first: an
// invalid document is never drawn or saved.

import type { Selection } from "./canvas/scene";
import { newDocument } from "./document/edit";
import type { DesignDocument } from "./document/types";
import { validateDocument } from "./document/validate";

const DRAFT_KEY = "thumbnail-studio:draft:v1";
const HISTORY_LIMIT = 60;

export interface CommitOptions {
  /** Consecutive commits with the same key are one undo step (a slider drag). */
  key?: string;
  /** Redraw the canvas but not the panels (the control being used stays put). */
  quiet?: boolean;
}

type Listener = (quiet: boolean) => void;

function loadDraft(): DesignDocument | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const result = validateDocument(JSON.parse(raw));
    return result.ok ? result.document : null;
  } catch {
    return null;
  }
}

function saveDraft(doc: DesignDocument): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(doc));
  } catch {
    // Private mode or storage full: the draft is a convenience, not a promise.
  }
}

export class Store {
  doc: DesignDocument = loadDraft() ?? newDocument();
  selection: Selection = null;
  private history: DesignDocument[] = [];
  private lastKey: string | undefined;
  private listeners: Listener[] = [];

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
      this.history.push(this.doc);
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
    }
    this.lastKey = options.key;
    this.doc = next;
    if (this.selection && !next.layers.some((l) => l.id === this.selection?.layerId)) this.selection = null;
    saveDraft(next);
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
    this.doc = previous;
    if (this.selection && !previous.layers.some((l) => l.id === this.selection?.layerId)) this.selection = null;
    saveDraft(previous);
    this.notify(false);
  }

  select(selection: Selection): void {
    this.selection = selection;
    this.lastKey = undefined;
    this.notify(false);
  }

  reset(): void {
    this.commit(newDocument());
    this.selection = null;
  }
}
