// The design document (ADR 0007): the one description of a thumbnail that the
// canvas, the host's gestures and, later, the orchestrator all read and write.
// The Konva scene is built from it; it is never read back from the scene.

export const DOCUMENT_VERSION = 1;
export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;

/** `#rrggbb`. Opacity, where it matters, is a separate number. */
export type Color = string;

export const BRAND = {
  red: "#E92827",
  white: "#FFFFFF",
  black: "#000000",
  yellow: "#FFD400",
} as const;

export interface SolidFill {
  type: "solid";
  color: Color;
}

/** A linear gradient across the word; `angle` in degrees, 90 is top to bottom. */
export interface GradientFill {
  type: "gradient";
  from: Color;
  to: Color;
  angle: number;
}

export type Fill = SolidFill | GradientFill;

// Effects follow Figma's model: each has its own parameters, in canvas pixels
// (for the title, in title pixels, so they grow with it).

export interface DropShadow {
  type: "dropShadow";
  color: Color;
  opacity: number;
  x: number;
  y: number;
  blur: number;
  spread: number;
}

export interface Glow {
  type: "glow";
  color: Color;
  opacity: number;
  blur: number;
}

export interface Outline {
  type: "outline";
  color: Color;
  width: number;
}

/** A soft disc of light behind a person; `size` is relative to their height. */
export interface Halo {
  type: "halo";
  color: Color;
  opacity: number;
  size: number;
}

/** Light catching one edge of a person, drawn just outside their cutout.
 *  `angle` is where the light comes from, in degrees (0 = right, 90 = below). */
export interface RimLight {
  type: "rimLight";
  color: Color;
  opacity: number;
  width: number;
  angle: number;
}

export type Effect = DropShadow | Glow | Outline | Halo | RimLight;
export type EffectType = Effect["type"];

export type EffectHost = "title" | "person" | "logo";

export const EFFECTS_FOR: Record<EffectHost, readonly EffectType[]> = {
  title: ["dropShadow", "glow", "outline"],
  person: ["dropShadow", "glow", "outline", "halo", "rimLight"],
  logo: ["dropShadow", "glow", "outline"],
};

/** A photo from the library, as the canvas needs it. */
export interface PhotoRef {
  photoId: string;
  src: string;
  width: number;
  height: number;
}

export interface BackgroundLayer {
  id: string;
  kind: "background";
  /** Drawn to cover the canvas. Without a photo, a gradient. */
  photo: PhotoRef | null;
  tone: "dark" | "light";
  flipX: boolean;
}

/** `x`, `y` are the centre of the photo on the canvas; `scale` multiplies the
 *  photo's own pixel size. */
export interface PersonLayer {
  id: string;
  kind: "person";
  photo: PhotoRef;
  x: number;
  y: number;
  scale: number;
  flipX: boolean;
  effects: Effect[];
}

/** The logo carries the show's name, so it is never mirrored. */
export interface LogoLayer {
  id: string;
  kind: "logo";
  photo: PhotoRef;
  x: number;
  y: number;
  scale: number;
  effects: Effect[];
}

/** Full bleed, always on top, not editable. */
export interface FrameLayer {
  id: string;
  kind: "frame";
  photo: PhotoRef;
}

export interface WordBox {
  color: Color;
}

export interface Word {
  /** Exactly as typed, no whitespace. */
  text: string;
  /** Font size in title pixels. */
  size: number;
  fill: Fill;
  box: WordBox | null;
  /** Starts a new line. Ignored on the first word. */
  breakBefore: boolean;
}

export type Align = "left" | "center" | "right";

/** `x`, `y` are the top-left of the title block on the canvas. */
export interface TitleLayer {
  id: string;
  kind: "title";
  /** What the host typed. The words, in order, must be exactly these. */
  text: string;
  words: Word[];
  /** Until the host breaks a line by hand, lines are wrapped automatically. */
  autoBreaks: boolean;
  align: Align;
  x: number;
  y: number;
  scale: number;
  effects: Effect[];
  /** The preset the effects started from, if any. */
  preset: string | null;
}

export type Layer = BackgroundLayer | PersonLayer | LogoLayer | FrameLayer | TitleLayer;
export type LayerKind = Layer["kind"];
export type MovableLayer = PersonLayer | LogoLayer | TitleLayer;

/** Layers are drawn in order: the background first, the frame (if any) last. */
export interface DesignDocument {
  version: typeof DOCUMENT_VERSION;
  width: typeof CANVAS_WIDTH;
  height: typeof CANVAS_HEIGHT;
  layers: Layer[];
}
