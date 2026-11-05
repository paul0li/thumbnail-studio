import { describe, expect, it } from "vitest";
import { scrollToShow } from "./keyboard";

describe("scrollToShow", () => {
  const view = { top: 200, bottom: 500 };

  it("leaves a field that is already in sight", () => {
    expect(scrollToShow({ top: 260, bottom: 340 }, view, 10)).toBe(0);
  });

  it("scrolls down when the keyboard covers the field", () => {
    expect(scrollToShow({ top: 520, bottom: 600 }, view, 10)).toBe(110);
  });

  it("scrolls up when the field is under the preview", () => {
    expect(scrollToShow({ top: 150, bottom: 230 }, view, 10)).toBe(-60);
  });

  it("shows the top of a field taller than the room", () => {
    expect(scrollToShow({ top: 400, bottom: 900 }, view, 10)).toBe(190);
  });
});
