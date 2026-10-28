// Where the host is in the routine and what is left, in plain words.

import { SAMPLE_TITLE } from "../document/edit";

export function isTitleDone(text: string): boolean {
  const typed = text.trim();
  return typed.length > 0 && typed !== SAMPLE_TITLE;
}

/** «Falta: conductor y título.», or null when nothing required is missing. */
export function missing(labels: readonly string[]): string | null {
  if (!labels.length) return null;
  const lower = labels.map((l) => l.toLowerCase());
  const list = lower.length === 1 ? lower[0] : `${lower.slice(0, -1).join(", ")} y ${lower.at(-1)}`;
  return `Falta: ${list}.`;
}
