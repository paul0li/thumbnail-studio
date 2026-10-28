import { describe, expect, it } from "vitest";
import { cardPicture, displayTitle, when } from "./history";

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

describe("the picture on a card", () => {
  const improved = { id: "imp1", version: 3, url: "/api/files/ab/improved.png", finished_at: null, chosen: false };

  it("shows the improved picture when there is one, even over a newer render of her own", () => {
    expect(cardPicture({ preview_url: "/api/files/cd/mine.png", improved })).toEqual({ src: improved.url, improved: true });
  });

  it("shows her own render when nothing was improved", () => {
    expect(cardPicture({ preview_url: "/api/files/cd/mine.png", improved: null })).toEqual({ src: "/api/files/cd/mine.png", improved: false });
    expect(cardPicture({ preview_url: null, improved: null })).toEqual({ src: null, improved: false });
  });
});
