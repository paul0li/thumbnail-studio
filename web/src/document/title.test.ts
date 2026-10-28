import { describe, expect, it } from "vitest";
import { newDocument, title } from "./edit";
import { mono } from "./testing";
import { retitle, splitWords, wordsMatchText } from "./title";

describe("splitWords", () => {
  it("splits on any whitespace and drops nothing else", () => {
    expect(splitWords("  ¿QUÉ   PASÓ?\nAYER ")).toEqual(["¿QUÉ", "PASÓ?", "AYER"]);
    expect(splitWords("   ")).toEqual([]);
  });
});

describe("wordsMatchText", () => {
  it("is a comparison of words in order", () => {
    expect(wordsMatchText(["NADIE", "LO", "VIO"], "nadie lo vio")).toBe(true);
    expect(wordsMatchText(["LO", "NADIE", "VIO"], "nadie lo vio")).toBe(false);
    expect(wordsMatchText(["NADIE", "LO"], "nadie lo vio")).toBe(false);
  });
});

describe("retitle", () => {
  it("keeps each word's style by position and keeps the typed casing", () => {
    const t = title(newDocument("UNO DOS"))!;
    const styled = { ...t, autoBreaks: false, words: [t.words[0]!, { ...t.words[1]!, size: 200, box: { color: "#FFD400" } }] };
    const next = retitle(styled, "Uno Dos Tres", mono);
    expect(next.words.map((w) => w.text)).toEqual(["Uno", "Dos", "Tres"]);
    expect(next.words[1]!.size).toBe(200);
    // A new word continues the style of the last one.
    expect(next.words[2]!.box).toEqual({ color: "#FFD400" });
    expect(wordsMatchText(next.words.map((w) => w.text), next.text)).toBe(true);
  });

  it("rewraps lines while breaks are automatic, and leaves them once set by hand", () => {
    const t = title(newDocument("A"))!;
    const auto = retitle(t, "AAAA BBBB CCCC DDDD EEEE", mono);
    expect(auto.words.some((w) => w.breakBefore)).toBe(true);
    const manual = retitle({ ...t, autoBreaks: false }, "AAAA BBBB CCCC DDDD EEEE", mono);
    expect(manual.words.some((w) => w.breakBefore)).toBe(false);
  });
});
