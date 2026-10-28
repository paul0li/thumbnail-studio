// The effect list of a layer, Figma-style: one card per effect, colour at a
// tap, the numbers tucked under «Ajustar».

import { BRAND, EFFECTS_FOR, type Effect, type EffectHost, type EffectType } from "../document/types";
import { announce, h } from "./dom";

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

/** Light colours get a dark check mark, dark ones a light one. */
const LIGHT = new Set([BRAND.white.toLowerCase(), BRAND.yellow.toLowerCase()]);

/** A colour button: named in Spanish, pressed when chosen, and marked with a
 *  check, so the choice is never told by colour alone. */
export function swatch(name: string, background: string, active: boolean, light: boolean, onPick: () => void): HTMLElement {
  return h(
    "button",
    {
      type: "button",
      class: `swatch${active ? " active" : ""}${light ? " light" : ""}`,
      style: { background },
      "aria-label": name,
      "aria-pressed": String(active),
      title: name,
      on: {
        click: () => {
          onPick();
          announce(`Color: ${name}`);
        },
      },
    },
    h("span", { "aria-hidden": "true" }, active ? "✓" : ""),
  );
}

export function swatchRow(current: string, onPick: (color: string) => void): HTMLElement {
  return h(
    "div",
    { class: "swatches", role: "group", "aria-label": "Color" },
    ...SWATCHES.map((s) =>
      swatch(s.name, s.color, s.color.toLowerCase() === current.toLowerCase(), LIGHT.has(s.color.toLowerCase()), () => onPick(s.color)),
    ),
  );
}

export function effectsEditor(effects: readonly Effect[], host: EffectHost, onChange: EffectsChange): HTMLElement {
  const replace = (index: number, effect: Effect) => effects.map((e, i) => (i === index ? effect : e));

  const cards = effects.map((effect, index) => {
    const sliders = PARAMS[effect.type].map((p) => {
      let value = (effect as unknown as Record<string, number>)[p.key] ?? 0;
      const output = h("output", { "aria-hidden": "true" }, format(value, p.step));
      const id = `fx-${host}-${index}-${p.key}`;
      const set = (v: number) => {
        value = Math.min(p.max, Math.max(p.min, Math.round(v / p.step) * p.step));
        output.textContent = format(value, p.step);
        input.value = String(value);
        effects = replace(index, { ...effects[index]!, [p.key]: value } as Effect);
        onChange(effects as Effect[], { key: `effect-${index}-${p.key}`, quiet: true });
      };
      const input = h("input", {
        id,
        type: "range",
        min: String(p.min),
        max: String(p.max),
        step: String(p.step),
        value: String(value),
        on: { input: (event: Event) => set(Number((event.target as HTMLInputElement).value)) },
      });
      // A slider is hard with a tremor: buttons move it a twentieth at a time.
      const big = Math.max(p.step, (p.max - p.min) / 20);
      const stepButton = (sign: 1 | -1) =>
        h(
          "button",
          {
            type: "button",
            class: "button step",
            "aria-label": `${sign > 0 ? "Más" : "Menos"} ${p.label.toLowerCase()}`,
            on: {
              click: () => {
                set(value + sign * big);
                announce(`${p.label}: ${format(value, p.step)}`);
              },
            },
          },
          h("span", { "aria-hidden": "true" }, sign > 0 ? "+" : "−"),
        );
      return h(
        "div",
        { class: "slider" },
        h("div", { class: "slider-head" }, h("label", { for: id }, p.label), output),
        h("div", { class: "slider-row" }, stepButton(-1), input, stepButton(1)),
      );
    });
    return h(
      "div",
      { class: "effect-card" },
      h(
        "div",
        { class: "effect-head" },
        h("h3", {}, EFFECT_NAMES[effect.type]),
        h(
          "button",
          {
            type: "button",
            class: "button small danger",
            "aria-label": `Quitar ${EFFECT_NAMES[effect.type].toLowerCase()}`,
            on: {
              click: () => {
                onChange(effects.filter((_, i) => i !== index), {});
                announce(`Efecto quitado: ${EFFECT_NAMES[effect.type]}. «Deshacer» lo devuelve.`);
              },
            },
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
        {
          type: "button",
          class: "chip",
          on: {
            click: () => {
              onChange([...effects, newEffect(type, host)], {});
              announce(`Efecto añadido: ${EFFECT_NAMES[type]}`);
            },
          },
        },
        `+ ${EFFECT_NAMES[type]}`,
      ),
    ),
  );

  return h(
    "section",
    { class: "group", "aria-labelledby": `effects-${host}` },
    h("h2", { id: `effects-${host}` }, "Efectos"),
    cards.length ? h("div", { class: "effect-list" }, ...cards) : h("p", { class: "muted" }, "Sin efectos."),
    add,
  );
}

function format(value: number, step: number): string {
  return step < 1 ? value.toFixed(2) : String(Math.round(value));
}
