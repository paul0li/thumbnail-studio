import { describe, expect, it } from "vitest";
import { elapsed, stageItems } from "./improve";

describe("the wait for «Mejorar»", () => {
  it("marks the steps before the current one as done and the rest as to come", () => {
    expect(stageItems("faces").map((s) => s.state)).toEqual(["done", "current", "todo", "todo"]);
    expect(stageItems(null).map((s) => s.state)).toEqual(["todo", "todo", "todo", "todo"]);
    expect(stageItems("done").every((s) => s.state === "done")).toBe(true);
  });

  it("says how long it has been, in minutes and seconds", () => {
    const start = "2026-10-28T10:00:00Z";
    expect(elapsed(start, Date.parse("2026-10-28T10:00:45Z"))).toBe("0:45");
    expect(elapsed(start, Date.parse("2026-10-28T10:01:02Z"))).toBe("1:02");
    expect(elapsed(start, Date.parse("2026-10-28T09:59:00Z"))).toBe("0:00");
  });
});
