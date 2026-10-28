// «Título»: type it, pick a look, then tap a word to style it.

import { title, updateTitle } from "../document/edit";
import type { Metrics } from "../document/layout";
import { applyPreset, PRESETS } from "../document/presets";
import { clampSize, retitle } from "../document/title";
import { BRAND, type Align, type Fill, type TitleLayer, type Word } from "../document/types";
import type { Store } from "../store";
import { h } from "./dom";
import { effectsEditor, swatchRow } from "./effects";

const GRADIENTS: { name: string; fill: Fill }[] = [
  { name: "Fuego", fill: { type: "gradient", from: BRAND.yellow, to: BRAND.red, angle: 90 } },
  { name: "Oro", fill: { type: "gradient", from: BRAND.white, to: BRAND.yellow, angle: 90 } },
];

const BOXES: { name: string; color: string | null }[] = [
  { name: "Sin caja", color: null },
  { name: "Roja", color: BRAND.red },
  { name: "Negra", color: BRAND.black },
  { name: "Amarilla", color: BRAND.yellow },
  { name: "Blanca", color: BRAND.white },
];

const ALIGNS: { name: string; align: Align }[] = [
  { name: "Izquierda", align: "left" },
  { name: "Centro", align: "center" },
  { name: "Derecha", align: "right" },
];

function sameFill(a: Fill, b: Fill): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function titlePanel(store: Store, metrics: Metrics): HTMLElement {
  const t = title(store.doc);
  if (!t) return h("div", { class: "panel-body" }, h("p", { class: "muted" }, "Esta miniatura no tiene título."));
  const selected = store.selection?.layerId === t.id ? store.selection.word : null;
  const targets = selected === null ? t.words.map((_, i) => i) : [selected];
  const editing = selected === null ? null : t.words[selected];

  const change = (fn: (t: TitleLayer) => TitleLayer, options = {}) => store.commit(updateTitle(store.doc, fn), options);
  const changeWords = (fn: (w: Word, index: number) => Word, options = {}) =>
    change((tl) => ({ ...tl, words: tl.words.map((w, i) => (targets.includes(i) ? fn(w, i) : w)) }), options);

  // The words, as chips. Rebuilt in place while typing so the input keeps focus.
  const words = h("div", { class: "chips words" });
  const renderWords = () => {
    const current = title(store.doc)!;
    const sel = store.selection?.layerId === current.id ? store.selection.word : null;
    words.replaceChildren(
      h("button", { class: `chip${sel === null ? " active" : ""}`, on: { click: () => store.select({ layerId: current.id, word: null }) } }, "Todas"),
      ...current.words.map((w, i) =>
        h(
          "button",
          { class: `chip word${sel === i ? " active" : ""}`, on: { click: () => store.select({ layerId: current.id, word: i }) } },
          (w.breakBefore && i > 0 ? "↵ " : "") + w.text,
        ),
      ),
    );
  };
  renderWords();

  const input = h("textarea", {
    rows: 2,
    value: t.text,
    autocapitalize: "characters",
    spellcheck: false,
    "aria-label": "Título",
    placeholder: "Escribe el título",
    on: {
      input: (event: Event) => {
        const text = (event.target as HTMLTextAreaElement).value;
        // The words come from what was typed, never the other way round.
        change((tl) => retitle(tl, text, metrics), { key: "title-text", quiet: true });
        const current = title(store.doc)!;
        if (store.selection?.word != null && store.selection.word >= current.words.length) {
          store.selection = { layerId: current.id, word: null };
        }
        renderWords();
      },
    },
  });

  const presets = h(
    "div",
    { class: "chips scroll" },
    ...PRESETS.map((p) =>
      h("button", { class: `chip${t.preset === p.id ? " active" : ""}`, on: { click: () => change((tl) => applyPreset(tl, p.id)) } }, p.label),
    ),
  );

  const first = t.words[targets[0] ?? 0];
  const size = editing?.size ?? first?.size ?? 120;
  const fill = (editing ?? first)?.fill;
  const box = (editing ?? first)?.box?.color ?? null;

  const wordEditor = t.words.length
    ? h(
        "section",
        { class: "group" },
        h("h3", {}, editing ? `Palabra «${editing.text}»` : "Todas las palabras"),
        h(
          "div",
          { class: "row stepper" },
          h("button", { class: "button", "aria-label": "Más chica", on: { click: () => changeWords((w) => ({ ...w, size: clampSize(w.size / 1.12) })) } }, "A−"),
          h("span", { class: "value" }, `${Math.round(size)} px`),
          h("button", { class: "button", "aria-label": "Más grande", on: { click: () => changeWords((w) => ({ ...w, size: clampSize(w.size * 1.12) })) } }, "A+"),
        ),
        h("h4", {}, "Color"),
        h(
          "div",
          { class: "row wrap" },
          swatchRow(fill?.type === "solid" ? fill.color : "", (color) => changeWords((w) => ({ ...w, fill: { type: "solid", color } }))),
          ...GRADIENTS.map((g) =>
            h("button", {
              class: `swatch gradient${fill && sameFill(fill, g.fill) ? " active" : ""}`,
              style: { background: g.fill.type === "gradient" ? `linear-gradient(${g.fill.from}, ${g.fill.to})` : "" },
              "aria-label": g.name,
              title: g.name,
              on: { click: () => changeWords((w) => ({ ...w, fill: g.fill })) },
            }),
          ),
        ),
        h("h4", {}, "Caja detrás"),
        h(
          "div",
          { class: "chips" },
          ...BOXES.map((b) =>
            h(
              "button",
              {
                class: `chip${box === b.color ? " active" : ""}`,
                on: { click: () => changeWords((w) => ({ ...w, box: b.color ? { color: b.color } : null })) },
              },
              b.name,
            ),
          ),
        ),
        editing && selected !== null && selected > 0
          ? h(
              "label",
              { class: "toggle" },
              h("input", {
                type: "checkbox",
                checked: editing.breakBefore,
                on: {
                  change: (event: Event) => {
                    const on = (event.target as HTMLInputElement).checked;
                    // Breaking a line by hand stops the automatic wrapping.
                    change((tl) => ({
                      ...tl,
                      autoBreaks: false,
                      words: tl.words.map((w, i) => (i === selected ? { ...w, breakBefore: on } : w)),
                    }));
                  },
                },
              }),
              h("span", {}, "Empezar una línea nueva aquí"),
            )
          : null,
      )
    : null;

  const align = h(
    "div",
    { class: "segmented" },
    ...ALIGNS.map((a) =>
      h("button", { class: t.align === a.align ? "active" : "", on: { click: () => change((tl) => ({ ...tl, align: a.align })) } }, a.name),
    ),
  );

  return h(
    "div",
    { class: "panel-body" },
    input,
    h("h3", {}, "Estilo"),
    presets,
    h("h3", {}, "Palabras"),
    h("p", { class: "muted" }, "Toca una palabra aquí o en la miniatura para cambiarla sola."),
    words,
    wordEditor,
    h("section", { class: "group" }, h("h3", {}, "Alineación"), align),
    effectsEditor(t.effects, "title", (effects, options) => change((tl) => ({ ...tl, effects }), options)),
  );
}
