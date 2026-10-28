import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Offline, Stale, type SaveBody } from "./api";
import { newDocument, updateTitle } from "./document/edit";
import { retitle } from "./document/title";
import type { DesignDocument } from "./document/types";
import { Store } from "./store";
import { readLocal, SAVE_DELAY_MS, Saver, type KeyValue } from "./sync";

function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const titled = (doc: DesignDocument, text: string) => updateTitle(doc, (t) => retitle(t, text, null));

/** A server that numbers versions like the real one and can be told to fail. */
function fakeServer() {
  const saves: SaveBody[] = [];
  let head = 0;
  let fail: Error | null = null;
  const server = {
    saves,
    attempts: 0,
    failWith(error: Error | null) {
      fail = error;
    },
    bumpElsewhere() {
      head += 1;
    },
    save: async (_id: string, body: SaveBody) => {
      server.attempts += 1;
      if (fail) throw fail;
      if (body.base_version !== head) throw new Stale(head);
      saves.push(structuredClone(body));
      head += 1;
      return head;
    },
  };
  return server;
}

function setup() {
  const server = fakeServer();
  const storage = memory();
  const store = new Store();
  const saver = new Saver(store, {
    save: server.save,
    storage,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
  store.subscribe(() => saver.changed());
  store.open({ id: "t-test-0001", head: 0, current: { doc: newDocument(), version: null }, history: [] });
  return { server, storage, store, saver };
}

const settle = async () => {
  await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("saving as the host works", () => {
  it("saves once, a moment after the last of several quick changes", async () => {
    const { server, store, saver } = setup();
    await settle();
    expect(server.saves).toHaveLength(1);
    expect(server.saves[0]!.base_version).toBe(0);
    store.commit(titled(store.doc, "UNO"));
    await vi.advanceTimersByTimeAsync(300);
    store.commit(titled(store.doc, "UNO DOS"));
    await vi.advanceTimersByTimeAsync(300);
    store.commit(titled(store.doc, "UNO DOS TRES"));
    expect(server.saves).toHaveLength(1);
    await settle();
    expect(server.saves).toHaveLength(2);
    expect(server.saves[1]).toMatchObject({ base_version: 1, parent_version: 1 });
    expect(saver.status.kind).toBe("saved");
  });

  it("saves at once on a step change, without waiting", async () => {
    const { server, store, saver } = setup();
    await settle();
    store.commit(titled(store.doc, "YA"));
    await saver.flush();
    expect(server.saves).toHaveLength(2);
  });

  it("an undo that is saved points back past the state it undid", async () => {
    const { server, store, saver } = setup();
    await saver.flush(); // v1: the start
    store.commit(titled(store.doc, "B"));
    await saver.flush(); // v2
    store.commit(titled(store.doc, "C"));
    await saver.flush(); // v3
    store.undo(); // back to B, saved as v2
    expect(store.dirty()).toBe(true);
    await saver.flush();
    expect(server.saves.at(-1)).toMatchObject({ base_version: 3, parent_version: 1 });
    expect(store.head).toBe(4);
  });

  it("a slider drag is one undo step and one save", async () => {
    const { server, store } = setup();
    await settle();
    for (const text of ["A", "AB", "ABC"]) store.commit(titled(store.doc, text), { key: "drag" });
    await settle();
    expect(server.saves).toHaveLength(2);
    store.undo();
    expect(store.version).toBe(1);
  });
});

describe("when the server does not have the newest", () => {
  it("does not overwrite a version saved elsewhere, and says so", async () => {
    const { server, store, saver } = setup();
    await settle();
    server.bumpElsewhere();
    const statuses: string[] = [];
    saver.onStatus((s) => statuses.push(s.kind));
    store.commit(titled(store.doc, "DESDE AQUÍ"));
    await settle();
    expect(saver.status).toEqual({ kind: "conflict", version: 2 });
    expect(statuses).toContain("conflict");
    // Nothing more is sent until the host decides.
    store.commit(titled(store.doc, "DESDE AQUÍ OTRA"));
    await settle();
    expect(server.saves).toHaveLength(1);
    await saver.overwrite(2);
    expect(server.saves.at(-1)).toMatchObject({ base_version: 2 });
    expect(saver.status.kind).toBe("saved");
  });
});

describe("when the server cannot be reached", () => {
  it("a thumbnail opened from this device's copy saves with the parent it kept", async () => {
    const { server, store, saver } = setup();
    await saver.flush();
    store.open({ id: "t-test-0001", head: 1, current: { doc: titled(store.doc, "COPIA"), version: null }, history: [], parent: 1 });
    await saver.flush();
    expect(server.saves.at(-1)).toMatchObject({ base_version: 1, parent_version: 1 });
  });

  it("says so, keeps the change on this device and saves it when the server is back", async () => {
    const { server, storage, store, saver } = setup();
    await settle();
    server.failWith(new Offline());
    store.commit(titled(store.doc, "SIN RED"));
    await settle();
    expect(saver.status.kind).toBe("offline");
    const kept = readLocal(storage);
    expect(kept).toMatchObject({ id: "t-test-0001", head: 1, unsaved: true });
    expect(kept!.doc).toEqual(store.doc);

    server.failWith(null);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(saver.status.kind).toBe("saved");
    expect(server.saves.at(-1)!.document).toEqual(store.doc);
    expect(readLocal(storage)).toMatchObject({ unsaved: false, head: 2 });
  });

  it("keeps retrying, further apart, without flooding the server", async () => {
    const { server, store } = setup();
    await settle();
    server.failWith(new Offline());
    store.commit(titled(store.doc, "X"));
    await vi.advanceTimersByTimeAsync(60_000);
    // 2, 4, 8, then every 15 s.
    expect(server.attempts).toBeGreaterThanOrEqual(5);
    expect(server.attempts).toBeLessThanOrEqual(8);
  });
});
