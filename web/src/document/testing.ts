import type { Metrics } from "./layout";

/** A monospaced stand-in for Anton: every character is 0.5 em wide. */
export const mono: Metrics = {
  measure: (text, size) => text.length * size * 0.5,
  capHeight: 0.7,
  descent: 0.2,
};
