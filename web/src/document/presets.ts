// Title presets, Canva-style: a name that expands into ordinary effects and word
// styles, which can then be tweaked one by one. A preset is a starting point,
// not a mode: nothing remembers it except its name.

import { BRAND, type Effect, type Fill, type TitleLayer, type WordBox } from "./types";

export interface Preset {
  id: string;
  /** What the host reads. */
  label: string;
  effects: () => Effect[];
  fill: () => Fill;
  box: () => WordBox | null;
}

const white = (): Fill => ({ type: "solid", color: BRAND.white });
const noBox = (): WordBox | null => null;

export const PRESETS: readonly Preset[] = [
  {
    id: "outline",
    label: "Contorno",
    effects: () => [{ type: "outline", color: BRAND.black, width: 10 }],
    fill: white,
    box: noBox,
  },
  {
    id: "shadow",
    label: "Sombra",
    effects: () => [
      { type: "dropShadow", color: BRAND.black, opacity: 0.85, x: 6, y: 10, blur: 18, spread: 2 },
      { type: "outline", color: BRAND.black, width: 4 },
    ],
    fill: white,
    box: noBox,
  },
  {
    id: "neon",
    label: "Neón",
    effects: () => [
      { type: "glow", color: BRAND.red, opacity: 1, blur: 40 },
      { type: "glow", color: BRAND.red, opacity: 1, blur: 12 },
      { type: "outline", color: BRAND.red, width: 3 },
    ],
    fill: white,
    box: noBox,
  },
  {
    id: "red-box",
    label: "Caja roja",
    effects: () => [
      { type: "dropShadow", color: BRAND.black, opacity: 0.6, x: 0, y: 8, blur: 16, spread: 0 },
    ],
    fill: white,
    box: () => ({ color: BRAND.red }),
  },
  {
    id: "echo",
    label: "Eco",
    effects: () => [
      { type: "dropShadow", color: BRAND.red, opacity: 1, x: 8, y: 8, blur: 0, spread: 0 },
      { type: "dropShadow", color: BRAND.yellow, opacity: 1, x: 16, y: 16, blur: 0, spread: 0 },
      { type: "outline", color: BRAND.black, width: 4 },
    ],
    fill: white,
    box: noBox,
  },
  {
    id: "fire",
    label: "Fuego",
    effects: () => [
      { type: "outline", color: BRAND.black, width: 8 },
      { type: "dropShadow", color: BRAND.black, opacity: 0.8, x: 0, y: 10, blur: 20, spread: 0 },
    ],
    fill: () => ({ type: "gradient", from: BRAND.yellow, to: BRAND.red, angle: 90 }),
    box: noBox,
  },
];

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** The title with the preset's effects and every word restyled by it. Sizes,
 *  words and line breaks are kept. */
export function applyPreset(title: TitleLayer, id: string): TitleLayer {
  const preset = findPreset(id);
  if (!preset) throw new Error(`unknown preset: ${id}`);
  return {
    ...title,
    preset: preset.id,
    effects: preset.effects(),
    words: title.words.map((w) => ({ ...w, fill: preset.fill(), box: preset.box() })),
  };
}
