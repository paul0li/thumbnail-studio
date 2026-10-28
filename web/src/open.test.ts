import { describe, expect, it } from "vitest";
import type { ThumbnailState } from "./api";
import { newDocument } from "./document/edit";
import { reconcile } from "./open";
import type { LocalCopy } from "./sync";

const a = newDocument("A");
const b = newDocument("B");
const c = newDocument("C LOCAL");

function server(version: number): ThumbnailState {
  return {
    id: "t-1",
    version,
    title: "B",
    created_at: "",
    updated_at: "",
    preview_url: null,
    downloaded: false,
    export_url: null,
    exported_at: null,
    export_improved: false,
    improved: null,
    improvement: null,
    document: b,
    history: [{ version: version - 1, document: a }],
  };
}

const local = (head: number, unsaved = true): LocalCopy => ({ id: "t-1", head, parent: null, doc: c, unsaved });

describe("opening a thumbnail", () => {
  it("opens the server's version with its undo history", () => {
    const start = reconcile("t-1", server(2), null)!;
    expect(start.status.kind).toBe("saved");
    expect(start.opened.current).toEqual({ doc: b, version: 2 });
    expect(start.opened.history).toEqual([{ doc: a, version: 1 }]);
  });

  it("puts this device's unsaved change on top when it was made on the same version", () => {
    const start = reconcile("t-1", server(2), local(2))!;
    expect(start.status.kind).toBe("saving");
    expect(start.opened.current).toEqual({ doc: c, version: null });
    // Undo goes back to what the server had.
    expect(start.opened.history.at(-1)).toEqual({ doc: b, version: 2 });
  });

  it("does not overwrite a newer version saved elsewhere: it is a conflict", () => {
    const start = reconcile("t-1", server(5), local(2))!;
    expect(start.status).toEqual({ kind: "conflict", version: 5 });
    expect(start.opened.current.doc).toEqual(c);
  });

  it("opens this device's copy when the server cannot be reached", () => {
    const start = reconcile("t-1", "offline", { ...local(2), parent: 1 })!;
    expect(start.status.kind).toBe("offline");
    // Its save still says what one undo step back is, so the undo history
    // is whole again once the server has it.
    expect(start.opened.parent).toBe(1);
    expect(start.opened.current.doc).toEqual(c);
    expect(reconcile("t-1", "offline", null)).toBeNull();
  });

  it("creates a thumbnail that was made offline and never reached the server", () => {
    expect(reconcile("t-1", null, local(0))?.status.kind).toBe("saving");
    expect(reconcile("t-1", null, local(3))).toBeNull();
  });

  it("ignores this device's copy of a different thumbnail", () => {
    expect(reconcile("t-2", "offline", local(2))).toBeNull();
  });
});
