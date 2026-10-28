// The effect list of a layer, Figma-style: one card per effect, colour at a
// tap, the numbers tucked under «Ajustar».

import { BRAND, EFFECTS_FOR, type Effect, type EffectHost, type EffectType } from "../document/types";
import { h } from "./dom";

export const EFFECT_NAMES: Record<EffectType, string> = {
  dropShadow: "Sombra",
  glow: "Resplandor",
  outline: "Contorno",
  halo: "Halo",
  rimLight: "Luz de borde",
};

export const SWATCHES: { name: string; color: string }[] = [
  { name: "Blanco", color: BRAND.white },
  { name: "Amarillo", color: BRAND.yellow },
  { name: "Rojo", color: BRAND.red },
  { name: "Negro", color: BRAND.black },
];

export function newEffect(type: EffectType, host: EffectHost): Effect {
  switch (type) {
    case "dropShadow":
      return { type, color: BRAND.black, opacity: 0.8, x: 6, y: 10, blur: 18, spread: 0 };
    case "glow":
      return { type, color: BRAND.yellow, opacity: 0.9, blur: 30 };
    case "outline":
      return host === "title" ? { type, color: BRAND.black, width: 8 } : { type, color: BRAND.white, width: 6 };
    case "halo":
      return { type, color: BRAND.yellow, opacity: 0.7, size: 1.1 };
    case "rimLight":
      return { type, color: BRAND.white, opacity: 0.9, width: 10, angle: -45 };
  }
}

interface Param {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

const PARAMS: Record<EffectType, Param[]> = {
  dropShadow: [
    { key: "x", label: "Horizontal", min: -60, max: 60, step: 1 },
    { key: "y", label: "Vertical", min: -60, max: 60, step: 1 },
    { key: "blur", label: "Desenfoque", min: 0, max: 80, step: 1 },
    { key: "spread", label: "Expansión", min: 0, max: 30, step: 1 },
    { key: "opacity", label: "Intensidad", min: 0, max: 1, step: 0.05 },
  ],
  glow: [
    { key: "blur", label: "Tamaño", min: 2, max: 120, step: 1 },
    { key: "opacity", label: "Intensidad", min: 0, max: 1, step: 0.05 },
  ],
  outline: [{ key: "width", label: "Grosor", min: 1, max: 40, step: 1 }],
  halo: [
    { key: "size", label: "Tamaño", min: 0.3, max: 2.5, step: 0.05 },
    { key: "opacity", label: "Intensidad", min: 0, max: 1, step: 0.05 },
  ],
  rimLight: [
    { key: "width", label: "Grosor", min: 2, max: 40, step: 1 },
    { key: "angle", label: "Dirección", min: -180, max: 180, step: 5 },
    { key: "opacity", label: "Intensidad", min: 0, max: 1, step: 0.05 },
  ],
};

// Which «Ajustar» sections are open survives a redraw of the panel.
const openDetails = new Set<string>();

export type EffectsChange = (effects: Effect[], options: { key?: string; quiet?: boolean }) => void;

export function swatchRow(current: string, onPick: (color: string) => void): HTMLElement {
  return h(
    "div",
    { class: "swatches" },
    ...SWATCHES.map((s) =>
      h("button", {
        class: `swatch${s.color.toLowerCase() === current.toLowerCase() ? " active" : ""}`,
        style: { background: s.color },
        "aria-label": s.name,
        title: s.name,
        on: { click: () => onPick(s.color) },
      }),
    ),
  );
}

export function effectsEditor(effects: readonly Effect[], host: EffectHost, onChange: EffectsChange): HTMLElement {
  const replace = (index: number, effect: Effect) => effects.map((e, i) => (i === index ? effect : e));

  const cards = effects.map((effect, index) => {
    const sliders = PARAMS[effect.type].map((p) => {
      const value = (effect as unknown as Record<string, number>)[p.key] ?? 0;
      const output = h("output", {}, format(value, p.step));
      const input = h("input", {
        type: "range",
        min: String(p.min),
        max: String(p.max),
        step: String(p.step),
        value: String(value),
        "aria-label": p.label,
        on: {
          input: (event: Event) => {
            const v = Number((event.target as HTMLInputElement).value);
            output.textContent = format(v, p.step);
            effects = replace(index, { ...effects[index]!, [p.key]: v } as Effect);
            onChange(effects as Effect[], { key: `effect-${index}-${p.key}`, quiet: true });
          },
        },
      });
      return h("label", { class: "slider" }, h("span", {}, p.label), input, output);
    });
    return h(
      "div",
      { class: "effect-card" },
      h(
        "div",
        { class: "effect-head" },
        h("strong", {}, EFFECT_NAMES[effect.type]),
        h(
          "button",
          {
            class: "link danger",
            on: { click: () => onChange(effects.filter((_, i) => i !== index), {}) },
          },
          "Quitar",
        ),
      ),
      swatchRow(effect.color, (color) => onChange(replace(index, { ...effect, color } as Effect), {})),
      h(
        "details",
        {
          open: openDetails.has(`${host}-${index}`),
          on: {
            toggle: (event: Event) => {
              const key = `${host}-${index}`;
              if ((event.target as HTMLDetailsElement).open) openDetails.add(key);
              else openDetails.delete(key);
            },
          },
        },
        h("summary", {}, "Ajustar"),
        ...sliders,
      ),
    );
  });

  const add = h(
    "div",
    { class: "chips" },
    ...EFFECTS_FOR[host].map((type) =>
      h(
        "button",
        { class: "chip", on: { click: () => onChange([...effects, newEffect(type, host)], {}) } },
        `+ ${EFFECT_NAMES[type]}`,
      ),
    ),
  );

  return h(
    "section",
    { class: "group" },
    h("h3", {}, "Efectos"),
    cards.length ? h("div", { class: "effect-list" }, ...cards) : h("p", { class: "muted" }, "Sin efectos."),
    add,
  );
}

function format(value: number, step: number): string {
  return step < 1 ? value.toFixed(2) : String(Math.round(value));
}
