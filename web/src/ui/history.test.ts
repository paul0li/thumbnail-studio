import { describe, expect, it } from "vitest";
import { displayTitle, when } from "./history";

describe("the history in words", () => {
  const now = new Date(2026, 9, 27, 12, 0);

  it("says today and yesterday, and the day further back", () => {
    expect(when(new Date(2026, 9, 27, 9, 5).toISOString(), now)).toMatch(/^Hoy, 0?9:05/);
    expect(when(new Date(2026, 9, 26, 23, 59).toISOString(), now)).toMatch(/^Ayer, /);
    expect(when(new Date(2026, 9, 21, 10, 0).toISOString(), now)).toMatch(/^Miércoles,? 21 de octubre$/);
  });

  it("names a thumbnail without a title yet plainly", () => {
    expect(displayTitle({ title: "ESCRIBE EL TÍTULO" })).toBe("Sin título todavía");
    expect(displayTitle({ title: "" })).toBe("Sin título todavía");
    expect(displayTitle({ title: "NADIE LO VIO" })).toBe("NADIE LO VIO");
  });
});
