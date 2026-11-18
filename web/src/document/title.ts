// The title is made of the words the host typed, and nothing else.

import { autoBreaks, layoutTitle, type Metrics } from "./layout";
import { BRAND, CANVAS_WIDTH, type TextKind, type TextLayer, type Word } from "./types";

export const DEFAULT_WORD_SIZE = 80;
/** The subtitle starts at about half the title's size. */
export const SUBTITLE_WORD_SIZE = 44;
/** How wide an automatically wrapped line may get, in title pixels. */
export const AUTO_WRAP_WIDTH = 940;
export const MIN_WORD_SIZE = 40;
export const MAX_WORD_SIZE = 320;

/** The words of a typed title: split on any whitespace, nothing dropped. */
export function splitWords(text: string): string[] {
  return text.split(/\s+/u).filter((w) => w.length > 0);
}

function fold(word: string): string {
  return word.toLocaleUpperCase("es");
}

/** Whether `words` are exactly what was typed, in order. Case does not matter
 *  for the comparison; the typed casing is what gets drawn. */
export function wordsMatchText(words: readonly string[], text: string): boolean {
  const typed = splitWords(text);
  return typed.length === words.length && typed.every((w, i) => fold(w) === fold(words[i]!));
}

/** The size every word of a plain title or subtitle starts at. */
export function defaultSize(kind: TextKind): number {
  return kind === "subtitle" ? SUBTITLE_WORD_SIZE : DEFAULT_WORD_SIZE;
}

export function defaultWord(text: string, size: number = DEFAULT_WORD_SIZE): Word {
  return {
    text,
    size,
    fill: { type: "solid", color: BRAND.white },
    box: null,
    breakBefore: false,
  };
}

/** The episode's title is always in capitals, however it is typed; the
 *  subtitle keeps the case it was typed in. */
export function caseFor(kind: TextKind, text: string): string {
  return kind === "title" ? text.toLocaleUpperCase("es") : text;
}

/**
 * The title after the host retypes it, in capitals if it is the title. A word keeps the style of the word that
 * was in its place; new words at the end take the style of the last one.
 * With `autoBreaks` on, lines are rewrapped; otherwise the breaks stay by position.
 */
export function retitle<T extends TextLayer>(title: T, typedText: string, metrics: Metrics | null): T {
  const text = caseFor(title.kind, typedText);
  const typed = splitWords(text);
  const last = title.words[title.words.length - 1];
  let words: Word[] = typed.map((w, i) => {
    const previous = title.words[i];
    if (previous) return { ...previous, text: w };
    if (last) return { ...last, text: w, breakBefore: false };
    return defaultWord(w, defaultSize(title.kind));
  });
  if (title.autoBreaks && metrics) words = autoBreaks(words, AUTO_WRAP_WIDTH, metrics);
  const changed = { ...title, text, words };
  return metrics ? keepCentred(title, changed, metrics) : changed;
}

/** The block centred on the canvas: its left edge follows its width. */
export function centred<T extends TextLayer>(text: T, metrics: Metrics): T {
  const { width } = layoutTitle(text.words, text.align, metrics);
  return { ...text, x: Math.round((CANVAS_WIDTH - width * text.scale) / 2) };
}

/** Whether a centre-aligned block sits centred on the canvas. */
export function isCentred(text: TextLayer, metrics: Metrics): boolean {
  return text.align === "center" && Math.abs(centred(text, metrics).x - text.x) <= 1;
}

/** A block that was centred on the canvas stays centred as its words change;
 *  one the host moved stays where they put it. */
export function keepCentred<T extends TextLayer>(before: TextLayer, after: T, metrics: Metrics): T {
  return isCentred(before, metrics) ? centred(after, metrics) : after;
}

export function clampSize(size: number): number {
  return Math.min(MAX_WORD_SIZE, Math.max(MIN_WORD_SIZE, Math.round(size)));
}
