// Where each word of the title goes. Pure: the text measurement is passed in,
// so the same layout runs in the browser and in tests.

import type { Align, Word } from "./types";

export interface Metrics {
  /** Advance width of `text` at `size` px. */
  measure(text: string, size: number): number;
  /** Cap height as a fraction of the font size. */
  capHeight: number;
  /** Descender depth as a fraction of the font size. */
  descent: number;
}

/** Space between words, as a fraction of the larger of the two. */
export const WORD_SPACE = 0.2;
/** Space between lines, as a fraction of the larger size in the line below. */
export const LINE_GAP = 0.14;
/** Padding of the box behind a word, as fractions of its size. */
export const BOX_PAD_X = 0.16;
export const BOX_PAD_Y = 0.13;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WordLayout {
  index: number;
  /** Where the text starts and its baseline, in title pixels. */
  x: number;
  baseline: number;
  width: number;
  size: number;
  /** The box behind the word, if it has one. */
  box: Rect | null;
  /** What a tap on the word hits. */
  bounds: Rect;
}

export interface LineLayout {
  words: WordLayout[];
  width: number;
  baseline: number;
}

export interface TitleLayout {
  width: number;
  height: number;
  lines: LineLayout[];
}

/** Splits the words into lines at each `breakBefore`. */
export function lines(words: readonly Word[]): number[][] {
  const result: number[][] = [];
  words.forEach((word, index) => {
    const current = result[result.length - 1];
    if (current === undefined || (word.breakBefore && index > 0)) {
      result.push([index]);
    } else {
      current.push(index);
    }
  });
  return result;
}

function advance(word: Word, metrics: Metrics): number {
  const text = metrics.measure(word.text, word.size);
  return word.box ? text + 2 * BOX_PAD_X * word.size : text;
}

function lineWidth(words: readonly Word[], indices: readonly number[], metrics: Metrics): number {
  let width = 0;
  indices.forEach((i, n) => {
    const word = words[i]!;
    if (n > 0) width += WORD_SPACE * Math.max(word.size, words[indices[n - 1]!]!.size);
    width += advance(word, metrics);
  });
  return width;
}

export function layoutTitle(words: readonly Word[], align: Align, metrics: Metrics): TitleLayout {
  const groups = lines(words);
  const widths = groups.map((g) => lineWidth(words, g, metrics));
  const blockWidth = Math.max(0, ...widths);

  const result: LineLayout[] = [];
  let cursor = 0;
  groups.forEach((group, lineIndex) => {
    const members = group.map((i) => words[i]!);
    const top = Math.max(
      ...members.map((w) => metrics.capHeight * w.size + (w.box ? BOX_PAD_Y * w.size : 0)),
    );
    const bottom = Math.max(
      ...members.map((w) => (w.box ? BOX_PAD_Y * w.size : metrics.descent * w.size)),
    );
    if (lineIndex > 0) cursor += LINE_GAP * Math.max(...members.map((w) => w.size));
    const baseline = cursor + top;

    const width = widths[lineIndex]!;
    let x = align === "left" ? 0 : align === "center" ? (blockWidth - width) / 2 : blockWidth - width;
    const laid: WordLayout[] = [];
    group.forEach((i, n) => {
      const word = words[i]!;
      if (n > 0) x += WORD_SPACE * Math.max(word.size, words[group[n - 1]!]!.size);
      const textWidth = metrics.measure(word.text, word.size);
      const capTop = baseline - metrics.capHeight * word.size;
      if (word.box) {
        const padX = BOX_PAD_X * word.size;
        const padY = BOX_PAD_Y * word.size;
        const box = {
          x,
          y: capTop - padY,
          width: textWidth + 2 * padX,
          height: metrics.capHeight * word.size + 2 * padY,
        };
        laid.push({ index: i, x: x + padX, baseline, width: textWidth, size: word.size, box, bounds: box });
        x += box.width;
      } else {
        const bounds = { x, y: capTop, width: textWidth, height: baseline + metrics.descent * word.size - capTop };
        laid.push({ index: i, x, baseline, width: textWidth, size: word.size, box: null, bounds });
        x += textWidth;
      }
    });
    result.push({ words: laid, width, baseline });
    cursor = baseline + bottom;
  });

  return { width: blockWidth, height: cursor, lines: result };
}

/** Line breaks that keep each line within `maxWidth`, filling greedily. */
export function autoBreaks(words: readonly Word[], maxWidth: number, metrics: Metrics): Word[] {
  let lineStart = 0;
  return words.map((word, index) => {
    if (index === 0) return { ...word, breakBefore: false };
    const candidate = words.slice(lineStart, index + 1).map((w, n) => ({ ...w, breakBefore: n === 0 }));
    const width = lineWidth(candidate, candidate.map((_, n) => n), metrics);
    if (width > maxWidth) {
      lineStart = index;
      return { ...word, breakBefore: true };
    }
    return { ...word, breakBefore: false };
  });
}
