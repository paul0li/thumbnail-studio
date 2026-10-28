import { describe, expect, it } from "vitest";
import { accentRule, autoBreaks, BOX_PAD_X, layoutTitle, lines, WORD_SPACE } from "./layout";
import { mono } from "./testing";
import { defaultWord } from "./title";
import type { Word } from "./types";

function words(text: string, breaks: number[] = []): Word[] {
  return text.split(" ").map((w, i) => ({ ...defaultWord(w), size: 100, breakBefore: breaks.includes(i) }));
}

describe("lines", () => {
  it("starts a line at each break, ignoring one on the first word", () => {
    const ws = words("A B C D", [0, 2]);
    expect(lines(ws)).toEqual([[0, 1], [2, 3]]);
  });
});

describe("layoutTitle", () => {
  it("puts words of a line side by side on one baseline", () => {
    const layout = layoutTitle(words("AB CD"), "left", mono);
    expect(layout.lines).toHaveLength(1);
    const [a, b] = layout.lines[0]!.words;
    expect(a!.x).toBe(0);
    expect(a!.width).toBe(100);
    expect(b!.x).toBe(100 + WORD_SPACE * 100);
    expect(a!.baseline).toBe(70);
    expect(b!.baseline).toBe(70);
    expect(layout.width).toBe(220);
  });

  it("stacks lines downwards, each baseline below the previous", () => {
    const layout = layoutTitle(words("AB CD EF", [1, 2]), "left", mono);
    const baselines = layout.lines.map((l) => l.baseline);
    expect(baselines).toHaveLength(3);
    expect(baselines[1]!).toBeGreaterThan(baselines[0]! + 70);
    expect(baselines[2]! - baselines[1]!).toBeCloseTo(baselines[1]! - baselines[0]!);
  });

  it("a bigger word makes its line taller", () => {
    const ws = words("AB CD", [1]);
    ws[1] = { ...ws[1]!, size: 200 };
    const layout = layoutTitle(ws, "left", mono);
    expect(layout.lines[1]!.baseline - layout.lines[0]!.baseline).toBeGreaterThan(140);
  });

  it("centres and right-aligns lines within the block", () => {
    const ws = words("ABCD EF", [1]);
    const centre = layoutTitle(ws, "center", mono);
    expect(centre.lines[1]!.words[0]!.x).toBe((200 - 100) / 2);
    const right = layoutTitle(ws, "right", mono);
    expect(right.lines[1]!.words[0]!.x).toBe(100);
  });

  it("a box behind a word pads it and pushes the next word along", () => {
    const ws = words("AB CD");
    ws[0] = { ...ws[0]!, box: { color: "#E92827" } };
    const layout = layoutTitle(ws, "left", mono);
    const [a, b] = layout.lines[0]!.words;
    expect(a!.box).not.toBeNull();
    expect(a!.x).toBe(BOX_PAD_X * 100);
    expect(a!.box!.width).toBe(100 + 2 * BOX_PAD_X * 100);
    expect(b!.x).toBe(a!.box!.width + WORD_SPACE * 100);
    expect(a!.box!.y).toBeLessThan(0 + 1e-9);
  });

  it("an empty title has no lines and no size", () => {
    expect(layoutTitle([], "left", mono)).toEqual({ width: 0, height: 0, lines: [] });
  });
});

describe("autoBreaks", () => {
  it("wraps greedily so no line is wider than allowed", () => {
    const ws = autoBreaks(words("AB CD EF GH"), 400, mono);
    expect(ws.map((w) => w.breakBefore)).toEqual([false, false, false, true]);
    for (const line of layoutTitle(ws, "left", mono).lines) expect(line.width).toBeLessThanOrEqual(400);
  });

  it("never drops a word, even one wider than the line", () => {
    const ws = autoBreaks(words("ABCDEFGHIJ KL"), 300, mono);
    expect(ws.map((w) => w.text)).toEqual(["ABCDEFGHIJ", "KL"]);
    expect(ws[1]!.breakBefore).toBe(true);
  });
});

describe("accent bar", () => {
  it("sits under the last line and follows the alignment", () => {
    const layout = layoutTitle(words("NADIE LO VIO"), "left", mono);
    const left = accentRule(layout, "left");
    expect(left.x).toBe(0);
    expect(left.y).toBeGreaterThan(layout.height);
    const right = accentRule(layout, "right");
    expect(right.x + right.width).toBeCloseTo(layout.width);
  });
});
