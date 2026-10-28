// Drawing a word or a photo with its effects onto a 2D context.
//
// Canvas shadows (`shadowBlur`, `shadowOffset*`) are in device pixels and are
// NOT affected by the context transform. Every shadow here is therefore scaled
// by the context's own scale, which already includes the layer's scale, the
// stage's scale and the canvas pixel ratio. Without that, the export at
// 1280x720 would not look like the screen.
//
// Shadows that must not show the shape itself are drawn with the "shadow only"
// trick: the shape is drawn far outside the canvas and its shadow is offset
// back into place.

import { BOX_PAD_X, type Metrics, type WordLayout } from "../document/layout";
import type { Effect, Fill, Word } from "../document/types";

const FAR = 30000;
export const FONT_FAMILY = "Anton";

export function font(size: number): string {
  return `${size}px ${FONT_FAMILY}, Impact, sans-serif`;
}

/** Device pixels per local unit. Assumes no rotation (this editor has none). */
export function deviceScale(ctx: CanvasRenderingContext2D): number {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b);
}

export function rgba(hex: string, opacity = 1): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
}

interface Shadow {
  color: string;
  /** All in local units. */
  blur: number;
  dx: number;
  dy: number;
}

/** Runs `draw` so that only its shadow lands on the canvas. */
function shadowOnly(ctx: CanvasRenderingContext2D, shadow: Shadow, draw: () => void): void {
  const m = ctx.getTransform();
  const s = Math.hypot(m.a, m.b);
  ctx.save();
  ctx.translate(-FAR, 0);
  // A local shift of -FAR along x moves the drawing by -FAR*(a, b) on the
  // device; the shadow offset brings it back, plus the wanted offset.
  ctx.shadowOffsetX = FAR * m.a + shadow.dx * s;
  ctx.shadowOffsetY = FAR * m.b + shadow.dy * s;
  ctx.shadowBlur = shadow.blur * s;
  ctx.shadowColor = shadow.color;
  draw();
  ctx.restore();
}

function fillStyle(ctx: CanvasRenderingContext2D, fill: Fill, layout: WordLayout, metrics: Metrics): string | CanvasGradient {
  if (fill.type === "solid") return fill.color;
  const top = layout.baseline - metrics.capHeight * layout.size;
  const cx = layout.x + layout.width / 2;
  const cy = (top + layout.baseline) / 2;
  const rad = (fill.angle * Math.PI) / 180;
  // Half the extent of the word along the gradient direction.
  const half = (Math.abs(Math.cos(rad)) * layout.width + Math.abs(Math.sin(rad)) * (layout.baseline - top)) / 2;
  const dx = Math.cos(rad) * half;
  const dy = Math.sin(rad) * half;
  const gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  gradient.addColorStop(0, fill.from);
  gradient.addColorStop(1, fill.to);
  return gradient;
}

/**
 * One word: the box behind it, then shadows and glows, then outlines (widest
 * first), then the fill. Coordinates are title pixels; `fillText` uses the
 * alphabetic baseline, so the baseline is exact whatever the font's ascent.
 */
export function drawWord(
  ctx: CanvasRenderingContext2D,
  word: Word,
  layout: WordLayout,
  effects: readonly Effect[],
  metrics: Metrics,
): void {
  ctx.save();
  ctx.font = font(word.size);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  if (layout.box && word.box) {
    const b = layout.box;
    const radius = Math.min(BOX_PAD_X * word.size * 0.4, 12);
    const drawBox = () => {
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.width, b.height, radius);
      ctx.fill();
    };
    // The box casts the title's drop shadows too, so a plate lifts off the picture.
    for (const e of effects) {
      if (e.type !== "dropShadow") continue;
      ctx.fillStyle = "#000";
      shadowOnly(ctx, { color: rgba(e.color, e.opacity), blur: e.blur, dx: e.x, dy: e.y }, drawBox);
    }
    ctx.fillStyle = word.box.color;
    drawBox();
  }

  const outlines = effects.filter((e) => e.type === "outline").sort((a, b) => b.width - a.width);
  const widest = outlines[0]?.width ?? 0;
  /** The silhouette of the word including its outline. */
  const silhouette = (extra = 0) => {
    ctx.fillStyle = "#000";
    ctx.strokeStyle = "#000";
    ctx.fillText(word.text, layout.x, layout.baseline);
    const stroke = 2 * (widest + extra);
    if (stroke > 0) {
      ctx.lineWidth = stroke;
      ctx.strokeText(word.text, layout.x, layout.baseline);
    }
  };

  // Words in a box cast their shadow onto the box only through the box itself.
  if (!word.box) {
    for (const e of effects) {
      if (e.type === "dropShadow") {
        shadowOnly(ctx, { color: rgba(e.color, e.opacity), blur: e.blur, dx: e.x, dy: e.y }, () => silhouette(e.spread));
      }
    }
  }
  for (const e of effects) {
    if (e.type === "glow") {
      const shadow = { color: rgba(e.color, e.opacity), blur: e.blur, dx: 0, dy: 0 };
      // Twice: a single canvas shadow is too faint to read as a glow.
      shadowOnly(ctx, shadow, () => silhouette());
      shadowOnly(ctx, shadow, () => silhouette());
    }
  }
  for (const e of outlines) {
    if (e.type !== "outline" || e.width <= 0) continue;
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2 * e.width;
    ctx.strokeText(word.text, layout.x, layout.baseline);
  }
  ctx.fillStyle = fillStyle(ctx, word.fill, layout, metrics);
  ctx.fillText(word.text, layout.x, layout.baseline);
  ctx.restore();
}

/**
 * A photo centred on the origin, `width` x `height` local units, with its
 * effects drawn around the cutout and never on its pixels: everything is
 * behind the photo. `unit` is local units per effect unit (canvas pixel).
 */
export function drawPhoto(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number,
  flipX: boolean,
  effects: readonly Effect[],
  unit: number,
): void {
  const x = -width / 2;
  const y = -height / 2;
  const draw = () => {
    ctx.save();
    if (flipX) ctx.scale(-1, 1);
    ctx.drawImage(image, x, y, width, height);
    ctx.restore();
  };

  for (const e of effects) {
    if (e.type !== "halo") continue;
    const cy = y + height * 0.38;
    const r = e.size * height * 0.5;
    const gradient = ctx.createRadialGradient(0, cy, 0, 0, cy, r);
    gradient.addColorStop(0, rgba(e.color, e.opacity));
    gradient.addColorStop(0.55, rgba(e.color, e.opacity * 0.45));
    gradient.addColorStop(1, rgba(e.color, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const e of effects) {
    if (e.type === "dropShadow") {
      const color = rgba(e.color, e.opacity);
      const spread = e.spread * unit;
      const offsets = spread > 0 ? ring(spread) : [[0, 0] as const];
      for (const [ox, oy] of offsets) {
        shadowOnly(ctx, { color, blur: e.blur * unit, dx: e.x * unit + ox, dy: e.y * unit + oy }, draw);
      }
    }
  }
  for (const e of effects) {
    if (e.type === "glow") {
      const shadow = { color: rgba(e.color, e.opacity), blur: e.blur * unit, dx: 0, dy: 0 };
      shadowOnly(ctx, shadow, draw);
      shadowOnly(ctx, shadow, draw);
    }
  }
  for (const e of effects) {
    if (e.type === "rimLight" && e.width > 0) {
      const rad = (e.angle * Math.PI) / 180;
      // Shifted towards the light, so it peeks out on that side only.
      const dx = Math.cos(rad) * e.width * unit;
      const dy = Math.sin(rad) * e.width * unit;
      const color = rgba(e.color, e.opacity);
      shadowOnly(ctx, { color, blur: e.width * unit * 0.6, dx, dy }, draw);
      shadowOnly(ctx, { color, blur: e.width * unit * 0.25, dx: dx * 0.6, dy: dy * 0.6 }, draw);
    }
  }
  for (const e of effects) {
    if (e.type === "outline" && e.width > 0) {
      for (const [ox, oy] of ring(e.width * unit)) {
        shadowOnly(ctx, { color: e.color, blur: 0, dx: ox, dy: oy }, draw);
      }
    }
  }
  draw();
}

/** Offsets around a circle, for dilating a silhouette. */
function ring(radius: number): ReadonlyArray<readonly [number, number]> {
  const steps = 16;
  return Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return [Math.cos(a) * radius, Math.sin(a) * radius] as const;
  });
}

/** Draws `image` to cover `width` x `height`, cropping the overflow. */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  width: number,
  height: number,
  flipX: boolean,
): void {
  const scale = Math.max(width / image.width, height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.save();
  if (flipX) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
  ctx.restore();
}
