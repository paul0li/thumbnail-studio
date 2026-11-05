// What «Mejorar» sends (ADR 0010). The image engine gets the scene: the
// background, the people and the title (and subtitle, if any) in their plain
// style, all words alike, as the routine first draws them. The frame and the logo carry the show's
// name and are never sent: they are drawn apart, as an overlay, and pasted on
// top of the engine's result on the server.

import { autoBreaks, type Metrics } from "./layout";
import { brandStyle } from "./presets";
import { AUTO_WRAP_WIDTH, defaultSize, defaultWord, splitWords } from "./title";
import { isText, type DesignDocument, type Layer, type TextLayer } from "./types";

const isOverlay = (layer: Layer): boolean => layer.kind === "frame" || layer.kind === "logo";

/** The title (or subtitle) as a new thumbnail draws it: the typed words,
 *  each in the brand style at the same size, wrapped automatically. Where it
 *  is and how big it is stay as the host left them. */
export function plainTitle<T extends TextLayer>(title: T, metrics: Metrics): T {
  const words = splitWords(title.text).map((w) => defaultWord(w, defaultSize(title.kind)));
  return {
    ...title,
    ...brandStyle(),
    // Only the title carries the show's accent bar.
    ...(title.kind === "subtitle" ? { accent: null } : {}),
    autoBreaks: true,
    align: "left",
    words: autoBreaks(words, AUTO_WRAP_WIDTH, metrics),
  };
}

/** What the engine gets under the scene where there is no background photo. */
export const ENGINE_BLANK = "#ffffff";

/** The document the engine sees: everything but the frame and the logo, with
 *  plain text. A background without a photo is left out too, so the
 *  engine gets plain white (`ENGINE_BLANK`) instead of the editor's gradient. */
export function engineScene(doc: DesignDocument, metrics: Metrics): DesignDocument {
  return {
    ...doc,
    layers: doc.layers
      .filter((l) => !isOverlay(l) && !(l.kind === "background" && l.photo === null))
      .map((l) => (isText(l) ? plainTitle(l, metrics) : l)),
  };
}

/** Only the frame and the logo, in their order, over nothing. */
export function overlayLayers(doc: DesignDocument): Layer[] {
  return doc.layers.filter(isOverlay);
}
