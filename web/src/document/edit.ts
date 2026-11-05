// Edits to the design document. Each takes a document and returns a new one;
// gestures and panels only ever change the thumbnail through these.

import { accentRule, autoBreaks, layoutTitle, type Metrics } from "./layout";
import { brandStyle } from "./presets";
import { AUTO_WRAP_WIDTH, defaultWord, retitle, splitWords, SUBTITLE_WORD_SIZE } from "./title";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DOCUMENT_VERSION,
  type BackgroundLayer,
  type DesignDocument,
  type Effect,
  type Layer,
  type MovableLayer,
  type PersonLayer,
  type PhotoRef,
  type SubtitleLayer,
  type TextKind,
  type TextLayer,
  type TitleLayer,
  isText,
} from "./types";

export const MIN_SCALE_PX = 60;
export const MAX_SCALE_PX = 2400;
/** A new host is placed this tall, a new guest this tall, a new logo this
 *  wide: the proportions of the show's usual thumbnail. */
export const HOST_HEIGHT = 600;
export const GUEST_HEIGHT = 440;
export const LOGO_WIDTH = 220;
/** Guests start at the left edge and stand side by side, overlapping a little. */
const GUEST_LEFT = 20;
const GUEST_OVERLAP = 40;

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** The title a new thumbnail starts with, shown on the canvas until the host
 *  types theirs. */
export const SAMPLE_TITLE = "ESCRIBE EL TÍTULO";

export function newDocument(title = SAMPLE_TITLE): DesignDocument {
  const titleLayer: TitleLayer = {
    id: newId("title"),
    kind: "title",
    text: title,
    words: splitWords(title).map((w) => defaultWord(w)),
    autoBreaks: true,
    align: "left",
    // Top left, where the show's title always goes.
    x: 50,
    y: 50,
    scale: 1,
    ...brandStyle(),
  };
  return {
    version: DOCUMENT_VERSION,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    layers: [
      { id: newId("background"), kind: "background", photo: null, tone: "dark", flipX: false },
      titleLayer,
    ],
  };
}

export function findLayer(doc: DesignDocument, id: string): Layer | undefined {
  return doc.layers.find((l) => l.id === id);
}

export function background(doc: DesignDocument): BackgroundLayer {
  const first = doc.layers[0];
  if (first?.kind !== "background") throw new Error("document without background");
  return first;
}

export function title(doc: DesignDocument): TitleLayer | undefined {
  return doc.layers.find((l): l is TitleLayer => l.kind === "title");
}

export function subtitle(doc: DesignDocument): SubtitleLayer | undefined {
  return doc.layers.find((l): l is SubtitleLayer => l.kind === "subtitle");
}

export function textLayer(doc: DesignDocument, kind: TextKind): TextLayer | undefined {
  return kind === "title" ? title(doc) : subtitle(doc);
}

function replaceLayer(doc: DesignDocument, id: string, change: (layer: Layer) => Layer): DesignDocument {
  return { ...doc, layers: doc.layers.map((l) => (l.id === id ? change(l) : l)) };
}

function hasFrame(doc: DesignDocument): boolean {
  return doc.layers[doc.layers.length - 1]?.kind === "frame";
}

/** Inserts a layer on top of everything except the frame. */
function insertOnTop(doc: DesignDocument, layer: Layer): DesignDocument {
  const layers = [...doc.layers];
  layers.splice(hasFrame(doc) ? layers.length - 1 : layers.length, 0, layer);
  return { ...doc, layers };
}

/** Inserts a layer just below the title, so a new photo never hides it. */
function insertBelowTitle(doc: DesignDocument, layer: Layer): DesignDocument {
  const at = doc.layers.findIndex((l) => l.kind === "title");
  if (at < 0) return insertOnTop(doc, layer);
  const layers = [...doc.layers];
  layers.splice(at, 0, layer);
  return { ...doc, layers };
}

export function setBackgroundPhoto(doc: DesignDocument, photo: PhotoRef | null): DesignDocument {
  return replaceLayer(doc, background(doc).id, (l) => ({ ...(l as BackgroundLayer), photo }));
}

export function setBackgroundTone(doc: DesignDocument, tone: BackgroundLayer["tone"]): DesignDocument {
  return replaceLayer(doc, background(doc).id, (l) => ({ ...(l as BackgroundLayer), tone }));
}

export function people(doc: DesignDocument, slot?: PersonLayer["slot"]): PersonLayer[] {
  return doc.layers.filter((l): l is PersonLayer => l.kind === "person" && (!slot || l.slot === slot));
}

/** Adds a person where the routine puts them: the host flush with the right
 *  edge, each guest to the right of the guests already there. */
export function addPerson(doc: DesignDocument, photo: PhotoRef, slot: PersonLayer["slot"] = "guest"): DesignDocument {
  const height = slot === "host" ? HOST_HEIGHT : GUEST_HEIGHT;
  const scale = height / photo.height;
  const width = photo.width * scale;
  let x: number;
  if (slot === "host") {
    x = Math.max(CANVAS_WIDTH / 2, CANVAS_WIDTH - width / 2);
  } else {
    const right = Math.max(
      GUEST_LEFT,
      ...people(doc, "guest").map((g) => g.x + (g.photo.width * g.scale) / 2 - GUEST_OVERLAP),
    );
    x = Math.min(CANVAS_WIDTH, right + width / 2);
  }
  const layer: PersonLayer = {
    id: newId("person"),
    kind: "person",
    slot,
    photo,
    x,
    y: CANVAS_HEIGHT - height / 2,
    scale,
    flipX: false,
    effects: [],
  };
  // The host stands behind the guests, as in the show's thumbnails.
  const firstGuest = doc.layers.findIndex((l) => l.kind === "person" && l.slot === "guest");
  if (slot === "host" && firstGuest > 0) {
    const layers = [...doc.layers];
    layers.splice(firstGuest, 0, layer);
    return { ...doc, layers };
  }
  return insertBelowTitle(doc, layer);
}

/** The host is one person: choosing another replaces them, in their place. */
export function setHost(doc: DesignDocument, photo: PhotoRef | null): DesignDocument {
  const current = people(doc, "host")[0];
  const without = { ...doc, layers: doc.layers.filter((l) => l !== current) };
  if (!photo) return without;
  if (current && current.photo.photoId === photo.photoId) return doc;
  return addPerson(without, photo, "host");
}

/** Puts a guest in, or takes them out if that photo is already a guest. */
export function toggleGuest(doc: DesignDocument, photo: PhotoRef): DesignDocument {
  const existing = people(doc, "guest").find((g) => g.photo.photoId === photo.photoId);
  if (existing) return { ...doc, layers: doc.layers.filter((l) => l !== existing) };
  return addPerson(doc, photo, "guest");
}

export function setLogo(doc: DesignDocument, photo: PhotoRef | null): DesignDocument {
  const existing = doc.layers.find((l) => l.kind === "logo");
  const without = { ...doc, layers: doc.layers.filter((l) => l.kind !== "logo") };
  if (!photo) return without;
  const scale = existing?.kind === "logo" ? existing.scale : LOGO_WIDTH / photo.width;
  const layer = {
    id: existing?.id ?? newId("logo"),
    kind: "logo" as const,
    photo,
    x: existing?.kind === "logo" ? existing.x : 60 + (photo.width * scale) / 2,
    y: existing?.kind === "logo" ? existing.y : 50 + (photo.height * scale) / 2,
    scale,
    effects: existing?.kind === "logo" ? existing.effects : [],
  };
  return insertOnTop(without, layer);
}

export function setFrame(doc: DesignDocument, photo: PhotoRef | null): DesignDocument {
  const layers: Layer[] = doc.layers.filter((l) => l.kind !== "frame");
  if (photo) layers.push({ id: newId("frame"), kind: "frame", photo });
  return { ...doc, layers };
}

export function removeLayer(doc: DesignDocument, id: string): DesignDocument {
  const layer = findLayer(doc, id);
  if (!layer || layer.kind === "background" || layer.kind === "title") return doc;
  return { ...doc, layers: doc.layers.filter((l) => l.id !== id) };
}

/** The size, in canvas pixels, of a movable layer's photo; null for text. */
function photoSize(layer: MovableLayer, scale: number): { w: number; h: number } | null {
  if (isText(layer)) return null;
  return { w: layer.photo.width * scale, h: layer.photo.height * scale };
}

export function clampScale(layer: MovableLayer, scale: number): number {
  if (isText(layer)) return Math.min(4, Math.max(0.25, scale));
  const longest = Math.max(layer.photo.width, layer.photo.height);
  return Math.min(MAX_SCALE_PX / longest, Math.max(MIN_SCALE_PX / longest, scale));
}

/** Moving is free; only the centre must stay on the canvas. For the title,
 *  `centre` is the centre of its block, which the caller knows. */
export function clampCentre(x: number, y: number): { x: number; y: number } {
  return { x: Math.min(CANVAS_WIDTH, Math.max(0, x)), y: Math.min(CANVAS_HEIGHT, Math.max(0, y)) };
}

export function placeLayer(doc: DesignDocument, id: string, x: number, y: number, scale?: number): DesignDocument {
  return replaceLayer(doc, id, (l) => {
    if (l.kind !== "person" && l.kind !== "logo" && !isText(l)) return l;
    const s = clampScale(l, scale ?? l.scale);
    if (photoSize(l, s)) {
      const c = clampCentre(x, y);
      return { ...l, x: c.x, y: c.y, scale: s };
    }
    return { ...l, x, y, scale: s };
  });
}

export function flipLayer(doc: DesignDocument, id: string): DesignDocument {
  return replaceLayer(doc, id, (l) =>
    l.kind === "person" || l.kind === "background" ? { ...l, flipX: !l.flipX } : l,
  );
}

/** Moves a layer one step up (`+1`) or down (`-1`) among the layers between the
 *  background and the frame. */
export function reorder(doc: DesignDocument, id: string, step: 1 | -1): DesignDocument {
  const index = doc.layers.findIndex((l) => l.id === id);
  const target = index + step;
  const lastMovable = hasFrame(doc) ? doc.layers.length - 2 : doc.layers.length - 1;
  if (index <= 0 || target < 1 || target > lastMovable) return doc;
  const layers = [...doc.layers];
  [layers[index], layers[target]] = [layers[target]!, layers[index]!];
  return { ...doc, layers };
}

export function canReorder(doc: DesignDocument, id: string, step: 1 | -1): boolean {
  return reorder(doc, id, step) !== doc;
}

export function setEffects(doc: DesignDocument, id: string, effects: Effect[]): DesignDocument {
  return replaceLayer(doc, id, (l) =>
    l.kind === "person" || l.kind === "logo" || isText(l) ? { ...l, effects } : l,
  );
}

export function updateTitle(doc: DesignDocument, change: (t: TitleLayer) => TitleLayer): DesignDocument {
  const t = title(doc);
  if (!t) return doc;
  return replaceLayer(doc, t.id, () => change(t));
}

export function updateText(doc: DesignDocument, kind: TextKind, change: (t: TextLayer) => TextLayer): DesignDocument {
  const t = textLayer(doc, kind);
  if (!t) return doc;
  return replaceLayer(doc, t.id, () => change(t));
}

/** How far below the title's block (and its accent bar) a new subtitle starts. */
const SUBTITLE_GAP = 18;

/** Types the subtitle. The first word creates it, just under the title, left
 *  aligned with it, in the brand's effects without the accent bar; clearing
 *  it takes it away. */
export function setSubtitle(doc: DesignDocument, text: string, metrics: Metrics | null): DesignDocument {
  const current = subtitle(doc);
  if (splitWords(text).length === 0) {
    return current ? { ...doc, layers: doc.layers.filter((l) => l !== current) } : doc;
  }
  if (current) return replaceLayer(doc, current.id, () => retitle(current, text, metrics));
  const t = title(doc);
  let x = 50;
  let y = 250;
  if (t) {
    x = t.x;
    let bottom = 0;
    if (metrics) {
      const layout = layoutTitle(t.words, t.align, metrics);
      bottom = layout.height;
      if (t.accent && layout.lines.length) {
        const rule = accentRule(layout, t.align);
        bottom = Math.max(bottom, rule.y + rule.height);
      }
    }
    y = t.y + bottom * t.scale + SUBTITLE_GAP;
  }
  let words = splitWords(text).map((w) => defaultWord(w, SUBTITLE_WORD_SIZE));
  if (metrics) words = autoBreaks(words, AUTO_WRAP_WIDTH, metrics);
  const layer: SubtitleLayer = {
    id: newId("subtitle"),
    kind: "subtitle",
    text,
    words,
    autoBreaks: true,
    align: "left",
    x,
    y: Math.min(CANVAS_HEIGHT - SUBTITLE_WORD_SIZE, y),
    scale: 1,
    ...brandStyle(),
    accent: null,
  };
  // Just above the title, so both read over the photos.
  const at = t ? doc.layers.indexOf(t) + 1 : -1;
  if (at <= 0) return insertOnTop(doc, layer);
  const layers = [...doc.layers];
  layers.splice(at, 0, layer);
  return { ...doc, layers };
}

/** The photos a document uses, for highlighting them in the library. */
export function photosInUse(doc: DesignDocument): Set<string> {
  const ids = new Set<string>();
  for (const l of doc.layers) {
    if (isText(l)) continue;
    if (l.photo) ids.add(l.photo.photoId);
  }
  return ids;
}

/** Points every layer that uses a photo at a new version of it (after a
 *  cutout), keeping the height it is drawn at. */
export function replacePhoto(doc: DesignDocument, photo: PhotoRef): DesignDocument {
  return {
    ...doc,
    layers: doc.layers.map((l) => {
      if (isText(l) || !l.photo || l.photo.photoId !== photo.photoId) return l;
      if (l.kind === "person" || l.kind === "logo") {
        return { ...l, photo, scale: (l.scale * l.photo.height) / photo.height };
      }
      return { ...l, photo };
    }),
  };
}

/** One tap of «Más grande» / «Más chica». */
export const SCALE_STEP = 1.1;

/** The title's block at scale 1, from its layout. The title is placed by its
 *  top-left corner, so buttons need its size to keep its centre in place. */
export interface BlockSize {
  width: number;
  height: number;
}

/** Grows (`+1`) or shrinks (`-1`) a layer one step around its centre: the
 *  button alternative to pinching. */
export function scaleLayerStep(doc: DesignDocument, id: string, step: 1 | -1, block?: BlockSize): DesignDocument {
  const layer = findLayer(doc, id);
  if (!layer || (layer.kind !== "person" && layer.kind !== "logo" && !isText(layer))) return doc;
  const scale = clampScale(layer, step > 0 ? layer.scale * SCALE_STEP : layer.scale / SCALE_STEP);
  if (Math.abs(scale - layer.scale) < 1e-9) return doc;
  if (!isText(layer)) return placeLayer(doc, id, layer.x, layer.y, scale);
  const b = block ?? { width: 0, height: 0 };
  const cx = layer.x + (b.width * layer.scale) / 2;
  const cy = layer.y + (b.height * layer.scale) / 2;
  return placeLayer(doc, id, cx - (b.width * scale) / 2, cy - (b.height * scale) / 2, scale);
}
