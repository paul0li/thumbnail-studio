// Anton is loaded before the first draw: a canvas that draws text before its
// font is ready silently uses a fallback, and keeps the fallback's widths.

import type { Metrics } from "../document/layout";
import { FONT_FAMILY, font } from "./draw";

let metrics: Metrics | null = null;

export async function loadFont(): Promise<Metrics> {
  if (metrics) return metrics;
  const face = new FontFace(FONT_FAMILY, "url(/fonts/Anton-Regular.ttf)");
  await face.load();
  document.fonts.add(face);
  metrics = measureMetrics();
  return metrics;
}

/** Metrics read from the font itself, so the layout matches what is drawn. */
function measureMetrics(): Metrics {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const probe = 200;
  ctx.font = font(probe);
  const cap = ctx.measureText("H").actualBoundingBoxAscent / probe;
  const descent = ctx.measureText("gjpqy").actualBoundingBoxDescent / probe;
  return {
    capHeight: cap,
    descent,
    measure(text: string, size: number): number {
      ctx.font = font(size);
      return ctx.measureText(text).width;
    },
  };
}
