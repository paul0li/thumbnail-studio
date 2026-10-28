// The title is made of the words the host typed, and nothing else.

import { autoBreaks, type Metrics } from "./layout";
import { BRAND, type TitleLayer, type Word } from "./types";

export const DEFAULT_WORD_SIZE = 80;
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

export function defaultWord(text: string): Word {
  return {
    text,
    size: DEFAULT_WORD_SIZE,
    fill: { type: "solid", color: BRAND.white },
    box: null,
    breakBefore: false,
  };
}

/**
 * The title after the host retypes it. A word keeps the style of the word that
 * was in its place; new words at the end take the style of the last one.
 * With `autoBreaks` on, lines are rewrapped; otherwise the breaks stay by position.
 */
export function retitle(title: TitleLayer, text: string, metrics: Metrics | null): TitleLayer {
  const typed = splitWords(text);
  const last = title.words[title.words.length - 1];
  let words: Word[] = typed.map((w, i) => {
    const previous = title.words[i];
    if (previous) return { ...previous, text: w };
    if (last) return { ...last, text: w, breakBefore: false };
    return defaultWord(w);
  });
  if (title.autoBreaks && metrics) words = autoBreaks(words, AUTO_WRAP_WIDTH, metrics);
  return { ...title, text, words };
}

export function clampSize(size: number): number {
  return Math.min(MAX_WORD_SIZE, Math.max(MIN_WORD_SIZE, Math.round(size)));
}
