// Edits to the design document. Each takes a document and returns a new one;
// gestures and panels only ever change the thumbnail through these.

import { defaultWord, splitWords } from "./title";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DOCUMENT_VERSION,
  type BackgroundLayer,
  type DesignDocument,
  type Effect,
  type Layer,
  type MovableLayer,
  type PhotoRef,
  type TitleLayer,
} from "./types";

export const MIN_SCALE_PX = 60;
export const MAX_SCALE_PX = 2400;
/** A new person is placed this tall; a new logo this wide. */
export const PERSON_HEIGHT = 560;
export const LOGO_WIDTH = 220;

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function newDocument(title = "ESCRIBE EL TÍTULO"): DesignDocument {
  const titleLayer: TitleLayer = {
    id: newId("title"),
    kind: "title",
    text: title,
    words: splitWords(title).map(defaultWord),
    autoBreaks: true,
    align: "left",
    x: 60,
    y: 380,
    scale: 1,
    effects: [{ type: "outline", color: "#000000", width: 10 }],
    preset: "outline",
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

export function addPerson(doc: DesignDocument, photo: PhotoRef): DesignDocument {
  const people = doc.layers.filter((l) => l.kind === "person").length;
  const scale = PERSON_HEIGHT / photo.height;
  const x = [880, 400, 1080, 640][people % 4]!;
  return insertBelowTitle(doc, {
    id: newId("person"),
    kind: "person",
    photo,
    x,
    y: CANVAS_HEIGHT - (photo.height * scale) / 2,
    scale,
    flipX: false,
    effects: [],
  });
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

/** The size, in canvas pixels, of a movable layer's photo; null for the title. */
function photoSize(layer: MovableLayer, scale: number): { w: number; h: number } | null {
  if (layer.kind === "title") return null;
  return { w: layer.photo.width * scale, h: layer.photo.height * scale };
}

export function clampScale(layer: MovableLayer, scale: number): number {
  if (layer.kind === "title") return Math.min(4, Math.max(0.25, scale));
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
    if (l.kind !== "person" && l.kind !== "logo" && l.kind !== "title") return l;
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
    l.kind === "person" || l.kind === "logo" || l.kind === "title" ? { ...l, effects } : l,
  );
}

export function updateTitle(doc: DesignDocument, change: (t: TitleLayer) => TitleLayer): DesignDocument {
  const t = title(doc);
  if (!t) return doc;
  return replaceLayer(doc, t.id, () => change(t));
}

/** The photos a document uses, for highlighting them in the library. */
export function photosInUse(doc: DesignDocument): Set<string> {
  const ids = new Set<string>();
  for (const l of doc.layers) {
    if (l.kind === "title") continue;
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
      if (l.kind === "title" || !l.photo || l.photo.photoId !== photo.photoId) return l;
      if (l.kind === "person" || l.kind === "logo") {
        return { ...l, photo, scale: (l.scale * l.photo.height) / photo.height };
      }
      return { ...l, photo };
    }),
  };
}
