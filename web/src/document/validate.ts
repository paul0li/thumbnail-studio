// The validator is the contract between everyone who writes the document. A
// document that does not pass is rejected when it is written, not after it is
// drawn: in particular, a title whose words are not what was typed.

import { wordsMatchText } from "./title";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DOCUMENT_VERSION,
  EFFECTS_FOR,
  type DesignDocument,
  type EffectHost,
} from "./types";

export type ValidationResult =
  | { ok: true; document: DesignDocument }
  | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;

const COLOR = /^#[0-9a-fA-F]{6}$/;

class Checker {
  errors: string[] = [];

  fail(path: string, message: string): void {
    this.errors.push(`${path}: ${message}`);
  }

  object(value: unknown, path: string): value is Obj {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return true;
    this.fail(path, "must be an object");
    return false;
  }

  number(o: Obj, key: string, path: string, min = -Infinity, max = Infinity): void {
    const v = o[key];
    if (typeof v !== "number" || !Number.isFinite(v)) this.fail(`${path}.${key}`, "must be a number");
    else if (v < min || v > max) this.fail(`${path}.${key}`, `must be between ${min} and ${max}`);
  }

  positive(o: Obj, key: string, path: string): void {
    const v = o[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      this.fail(`${path}.${key}`, "must be a positive number");
    }
  }

  boolean(o: Obj, key: string, path: string): void {
    if (typeof o[key] !== "boolean") this.fail(`${path}.${key}`, "must be true or false");
  }

  string(o: Obj, key: string, path: string): void {
    if (typeof o[key] !== "string") this.fail(`${path}.${key}`, "must be a string");
  }

  color(o: Obj, key: string, path: string): void {
    const v = o[key];
    if (typeof v !== "string" || !COLOR.test(v)) this.fail(`${path}.${key}`, "must be a #rrggbb colour");
  }

  oneOf(o: Obj, key: string, path: string, options: readonly unknown[]): void {
    if (!options.includes(o[key])) {
      this.fail(`${path}.${key}`, `must be one of ${options.map(String).join(", ")}`);
    }
  }

  photo(value: unknown, path: string): void {
    if (!this.object(value, path)) return;
    this.string(value, "photoId", path);
    this.string(value, "src", path);
    this.positive(value, "width", path);
    this.positive(value, "height", path);
  }

  placement(o: Obj, path: string): void {
    this.number(o, "x", path, -CANVAS_WIDTH, 2 * CANVAS_WIDTH);
    this.number(o, "y", path, -CANVAS_HEIGHT, 2 * CANVAS_HEIGHT);
    this.positive(o, "scale", path);
  }

  effects(value: unknown, host: EffectHost, path: string): void {
    if (!Array.isArray(value)) {
      this.fail(path, "must be a list");
      return;
    }
    value.forEach((effect, i) => {
      const p = `${path}[${i}]`;
      if (!this.object(effect, p)) return;
      const type = effect.type;
      if (typeof type !== "string" || !(EFFECTS_FOR[host] as readonly string[]).includes(type)) {
        this.fail(`${p}.type`, `is not an effect a ${host} can have`);
        return;
      }
      this.color(effect, "color", p);
      switch (type) {
        case "dropShadow":
          this.number(effect, "opacity", p, 0, 1);
          this.number(effect, "x", p, -200, 200);
          this.number(effect, "y", p, -200, 200);
          this.number(effect, "blur", p, 0, 200);
          this.number(effect, "spread", p, 0, 100);
          break;
        case "glow":
          this.number(effect, "opacity", p, 0, 1);
          this.number(effect, "blur", p, 0, 200);
          break;
        case "outline":
          this.number(effect, "width", p, 0, 100);
          break;
        case "halo":
          this.number(effect, "opacity", p, 0, 1);
          this.number(effect, "size", p, 0.1, 3);
          break;
        case "rimLight":
          this.number(effect, "opacity", p, 0, 1);
          this.number(effect, "width", p, 0, 60);
          this.number(effect, "angle", p, -360, 360);
          break;
      }
    });
  }

  title(o: Obj, path: string): void {
    this.string(o, "text", path);
    this.boolean(o, "autoBreaks", path);
    this.oneOf(o, "align", path, ["left", "center", "right"]);
    this.placement(o, path);
    this.effects(o.effects, "title", `${path}.effects`);
    if (o.preset !== null && typeof o.preset !== "string") this.fail(`${path}.preset`, "must be a string or null");
    const words = o.words;
    if (!Array.isArray(words)) {
      this.fail(`${path}.words`, "must be a list");
      return;
    }
    const texts: string[] = [];
    words.forEach((word, i) => {
      const p = `${path}.words[${i}]`;
      if (!this.object(word, p)) return;
      if (typeof word.text !== "string" || word.text.length === 0 || /\s/u.test(word.text)) {
        this.fail(`${p}.text`, "must be one word, without spaces");
      } else {
        texts.push(word.text);
      }
      this.number(word, "size", p, 1, 1000);
      this.boolean(word, "breakBefore", p);
      if (word.box !== null) {
        if (this.object(word.box, `${p}.box`)) this.color(word.box, "color", `${p}.box`);
      }
      const fill = word.fill;
      if (this.object(fill, `${p}.fill`)) {
        if (fill.type === "solid") this.color(fill, "color", `${p}.fill`);
        else if (fill.type === "gradient") {
          this.color(fill, "from", `${p}.fill`);
          this.color(fill, "to", `${p}.fill`);
          this.number(fill, "angle", `${p}.fill`, -360, 360);
        } else this.fail(`${p}.fill.type`, "must be solid or gradient");
      }
    });
    if (typeof o.text === "string" && texts.length === words.length && !wordsMatchText(texts, o.text)) {
      this.fail(`${path}.words`, "must be exactly the words of the typed title, in order");
    }
  }
}

export function validateDocument(input: unknown): ValidationResult {
  const c = new Checker();
  if (!c.object(input, "document")) return { ok: false, errors: c.errors };
  if (input.version !== DOCUMENT_VERSION) c.fail("version", `must be ${DOCUMENT_VERSION}`);
  if (input.width !== CANVAS_WIDTH || input.height !== CANVAS_HEIGHT) {
    c.fail("size", `must be ${CANVAS_WIDTH}x${CANVAS_HEIGHT}`);
  }
  const layers = input.layers;
  if (!Array.isArray(layers)) {
    c.fail("layers", "must be a list");
    return { ok: false, errors: c.errors };
  }

  const ids = new Set<string>();
  const counts: Record<string, number> = {};
  layers.forEach((layer, i) => {
    const path = `layers[${i}]`;
    if (!c.object(layer, path)) return;
    if (typeof layer.id !== "string" || layer.id.length === 0) c.fail(`${path}.id`, "must be a string");
    else if (ids.has(layer.id)) c.fail(`${path}.id`, "is repeated");
    else ids.add(layer.id);
    const kind = String(layer.kind);
    counts[kind] = (counts[kind] ?? 0) + 1;
    switch (layer.kind) {
      case "background":
        if (i !== 0) c.fail(path, "the background must be the first layer");
        if (layer.photo !== null) c.photo(layer.photo, `${path}.photo`);
        c.oneOf(layer, "tone", path, ["dark", "light"]);
        c.boolean(layer, "flipX", path);
        break;
      case "person":
        c.photo(layer.photo, `${path}.photo`);
        c.placement(layer, path);
        c.boolean(layer, "flipX", path);
        c.effects(layer.effects, "person", `${path}.effects`);
        break;
      case "logo":
        c.photo(layer.photo, `${path}.photo`);
        c.placement(layer, path);
        c.effects(layer.effects, "logo", `${path}.effects`);
        break;
      case "frame":
        if (i !== layers.length - 1) c.fail(path, "the frame must be the last layer");
        c.photo(layer.photo, `${path}.photo`);
        break;
      case "title":
        c.title(layer, path);
        break;
      default:
        c.fail(`${path}.kind`, "is not a known layer");
    }
  });
  if (counts.background !== 1) c.fail("layers", "must have exactly one background");
  for (const kind of ["title", "logo", "frame"]) {
    if ((counts[kind] ?? 0) > 1) c.fail("layers", `may have at most one ${kind}`);
  }

  return c.errors.length === 0
    ? { ok: true, document: input as unknown as DesignDocument }
    : { ok: false, errors: c.errors };
}
