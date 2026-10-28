// What «Mejorar» sends (ADR 0010). The image engine gets the scene: the
// background, the people and the title in its plain style, all words alike,
// as the routine first draws it. The frame and the logo carry the show's
// name and are never sent: they are drawn apart, as an overlay, and pasted on
// top of the engine's result on the server.

import { autoBreaks, type Metrics } from "./layout";
import { brandStyle } from "./presets";
import { AUTO_WRAP_WIDTH, defaultWord, splitWords } from "./title";
import type { DesignDocument, Layer, TitleLayer } from "./types";

const isOverlay = (layer: Layer): boolean => layer.kind === "frame" || layer.kind === "logo";

/** The title as a new thumbnail draws it: the typed words, each in the
 *  brand style at the same size, wrapped automatically. Where it is and how
 *  big it is stay as the host left them. */
export function plainTitle(title: TitleLayer, metrics: Metrics): TitleLayer {
  const words = splitWords(title.text).map(defaultWord);
  return {
    ...title,
    ...brandStyle(),
    autoBreaks: true,
    align: "left",
    words: autoBreaks(words, AUTO_WRAP_WIDTH, metrics),
  };
}

/** The document the engine sees: everything but the frame and the logo, with
 *  a plain title. */
export function engineScene(doc: DesignDocument, metrics: Metrics): DesignDocument {
  return {
    ...doc,
    layers: doc.layers.filter((l) => !isOverlay(l)).map((l) => (l.kind === "title" ? plainTitle(l, metrics) : l)),
  };
}

/** Only the frame and the logo, in their order, over nothing. */
export function overlayLayers(doc: DesignDocument): Layer[] {
  return doc.layers.filter(isOverlay);
}
