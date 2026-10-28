// Saving as the host works: a save ~800 ms after the last change, and at once
// on a step change or when the page is hidden. There is no save button.
//
// Until the server confirms, the document is also kept on this device, so a
// closed tab or a server that is down loses nothing. What the host sees is
// always one of: saved, saving, no connection (kept here), or «this thumbnail
// changed elsewhere».

import { Gone, Offline, Stale, saveThumbnail, type SaveBody } from "./api";
import type { DesignDocument } from "./document/types";
import { validateDocument } from "./document/validate";
import type { Store } from "./store";

export const SAVE_DELAY_MS = 800;
const RETRY_MS = [2_000, 4_000, 8_000, 15_000];
const LOCAL_KEY = "thumbnail-studio:local:v1";

export type SyncStatus =
  | { kind: "saved" }
  | { kind: "saving" }
  | { kind: "offline" }
  /** Another tab or device saved a newer version first. */
  | { kind: "conflict"; version: number }
  /** The thumbnail was deleted elsewhere. */
  | { kind: "gone" };

/** What is kept on this device: the thumbnail last open and whether the
 *  server has it yet. */
export interface LocalCopy {
  id: string;
  /** The server version `doc` is based on (0: not created yet). */
  head: number;
  parent: number | null;
  doc: DesignDocument;
  /** Not confirmed by the server yet. */
  unsaved: boolean;
}

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readLocal(storage: KeyValue | null): LocalCopy | null {
  try {
    const raw = storage?.getItem(LOCAL_KEY);
    if (!raw) return null;
    const copy = JSON.parse(raw) as LocalCopy;
    if (typeof copy.id !== "string" || typeof copy.head !== "number") return null;
    const result = validateDocument(copy.doc);
    return result.ok ? { ...copy, doc: result.document } : null;
  } catch {
    return null;
  }
}

export interface SaverDeps {
  save: (id: string, body: SaveBody, options: { keepalive?: boolean }) => Promise<number>;
  storage: KeyValue | null;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

const browserDeps = (): SaverDeps => {
  let storage: KeyValue | null = null;
  try {
    storage = window.localStorage;
  } catch {
    // Storage blocked: the server is the only copy.
  }
  return {
    save: saveThumbnail,
    storage,
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  };
};

export class Saver {
  status: SyncStatus = { kind: "saved" };
  private timer: unknown = null;
  private inFlight: Promise<void> | null = null;
  private attempt = 0;
  private listeners: ((status: SyncStatus) => void)[] = [];
  private savedListeners: ((version: number) => void)[] = [];
  private readonly deps: SaverDeps;

  constructor(
    private readonly store: Store,
    deps?: Partial<SaverDeps>,
  ) {
    this.deps = { ...browserDeps(), ...deps };
  }

  onStatus(listener: (status: SyncStatus) => void): void {
    this.listeners.push(listener);
  }

  /** After each confirmed save of what is on screen. */
  onSaved(listener: (version: number) => void): void {
    this.savedListeners.push(listener);
  }

  private set(status: SyncStatus): void {
    const same = JSON.stringify(status) === JSON.stringify(this.status);
    this.status = status;
    if (!same) for (const l of this.listeners) l(status);
  }

  /** Whether saving is stopped until the host decides something. */
  blocked(): boolean {
    return this.status.kind === "conflict" || this.status.kind === "gone";
  }

  private keepLocal(): void {
    const { store } = this;
    if (!store.id) return;
    const copy: LocalCopy = { id: store.id, head: store.head, parent: store.parentVersion(), doc: store.doc, unsaved: store.dirty() };
    try {
      this.deps.storage?.setItem(LOCAL_KEY, JSON.stringify(copy));
    } catch {
      // Storage full or blocked: the server copy is what counts.
    }
  }

  /** Call after every change to the store (and after opening a thumbnail). */
  changed(): void {
    this.keepLocal();
    if (!this.store.dirty() || this.blocked()) return;
    if (this.status.kind !== "offline") this.set({ kind: "saving" });
    this.schedule(SAVE_DELAY_MS);
  }

  private schedule(ms: number): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  /** Saves now if anything is waiting. Resolves when the server has answered
   *  (or could not be reached). */
  async flush(options: { keepalive?: boolean } = {}): Promise<void> {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.inFlight) {
      await this.inFlight;
      // Something may have changed while that save was on its way.
      if (this.store.dirty() && !this.blocked()) return this.flush(options);
      return;
    }
    if (!this.store.id || !this.store.dirty() || this.blocked()) return;
    this.inFlight = this.send(options);
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
    if (this.store.dirty() && !this.blocked() && this.status.kind !== "offline") this.schedule(0);
  }

  private async send(options: { keepalive?: boolean }): Promise<void> {
    const { store } = this;
    const id = store.id;
    const doc = store.doc;
    const body: SaveBody = { base_version: store.head, parent_version: store.parentVersion(), document: doc };
    if (this.status.kind !== "offline") this.set({ kind: "saving" });
    try {
      const version = await this.deps.save(id, body, options);
      if (store.id !== id) return;
      store.saved(doc, version);
      this.attempt = 0;
      this.keepLocal();
      if (store.dirty()) this.set({ kind: "saving" });
      else {
        this.set({ kind: "saved" });
        for (const l of this.savedListeners) l(version);
      }
    } catch (error) {
      if (store.id !== id) return;
      if (error instanceof Stale) this.set({ kind: "conflict", version: error.version });
      else if (error instanceof Gone) this.set({ kind: "gone" });
      else {
        // Offline, or anything unexpected: keep trying, and say so.
        if (!(error instanceof Offline)) console.error(error);
        this.set({ kind: "offline" });
        this.schedule(RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)]!);
        this.attempt += 1;
      }
    }
  }

  /** Try again now (the connection came back, the page became visible). */
  retry(): void {
    if (this.status.kind === "offline") {
      this.attempt = 0;
      void this.flush();
    }
  }

  /** The host chose to keep this version over the one saved elsewhere. */
  overwrite(serverVersion: number): Promise<void> {
    this.store.rebase(serverVersion);
    this.set({ kind: "saving" });
    return this.flush();
  }

  /** A different thumbnail was opened: start from its state. */
  reset(status: SyncStatus = { kind: "saved" }): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.attempt = 0;
    this.set(status);
    this.changed();
  }

  /** Whether everything on screen is on the server. */
  settled(): boolean {
    return !this.store.dirty() && this.inFlight === null;
  }
}
