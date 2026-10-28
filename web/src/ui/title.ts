// «Título»: type it, pick a look, then tap a word to style it.

import { SAMPLE_TITLE, title, updateTitle } from "../document/edit";
import { layoutTitle, type Metrics } from "../document/layout";
import { applyPreset, PRESETS } from "../document/presets";
import { clampSize, retitle } from "../document/title";
import { BRAND, type Align, type Fill, type TitleLayer, type Word } from "../document/types";
import type { Store } from "../store";
import { advanced, announce, h } from "./dom";
import { effectsEditor, swatch, swatchRow } from "./effects";
import { placementControls } from "./placement";
import { isTitleDone } from "./progress";

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
      h(
        "button",
        {
          type: "button",
          class: `chip${sel === null ? " active" : ""}`,
          "aria-pressed": String(sel === null),
          on: { click: () => store.select({ layerId: current.id, word: null }) },
        },
        "Todas",
      ),
      ...current.words.map((w, i) =>
        h(
          "button",
          {
            type: "button",
            class: `chip word${sel === i ? " active" : ""}`,
            "aria-pressed": String(sel === i),
            "aria-label": w.breakBefore && i > 0 ? `${w.text}, empieza línea` : w.text,
            on: { click: () => store.select({ layerId: current.id, word: i }) },
          },
          h("span", { "aria-hidden": "true" }, (w.breakBefore && i > 0 ? "↵ " : "") + w.text),
        ),
      ),
    );
  };
  renderWords();

  const hintText = (text: string) =>
    isTitleDone(text) ? "El estilo de la marca ya está puesto." : "Es un ejemplo: toca y escribe el tuyo encima.";
  const hint = h("p", { class: "muted", id: "title-sample" }, hintText(t.text));
  const input = h("textarea", {
    id: "title-text",
    rows: 2,
    value: t.text,
    autocapitalize: "characters",
    spellcheck: false,
    "aria-describedby": "title-sample",
    on: {
      // The sample title is meant to be replaced: one tap selects it all, so
      // typing writes over it without deleting letter by letter.
      focus: (event: Event) => {
        const el = event.target as HTMLTextAreaElement;
        if (el.value === SAMPLE_TITLE) el.select();
      },
      input: (event: Event) => {
        const text = (event.target as HTMLTextAreaElement).value;
        hint.textContent = hintText(text);
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
    { class: "chips", role: "group", "aria-label": "Estilo" },
    ...PRESETS.map((p) =>
      h(
        "button",
        {
          type: "button",
          class: `chip${t.preset === p.id ? " active" : ""}`,
          "aria-pressed": String(t.preset === p.id),
          on: {
            click: () => {
              change((tl) => applyPreset(tl, p.id));
              announce(`Estilo: ${p.label}`);
            },
          },
        },
        p.label,
      ),
    ),
  );

  const first = t.words[targets[0] ?? 0];
  const size = editing?.size ?? first?.size ?? 120;
  const fill = (editing ?? first)?.fill;
  const box = (editing ?? first)?.box?.color ?? null;

  const sizeValue = h("span", { class: "value" }, `${Math.round(size)} px`);
  // Quiet, so the button keeps the focus; the size is said out loud instead.
  const resize = (sign: 1 | -1, label: string) =>
    h(
      "button",
      {
        type: "button",
        class: "button",
        on: {
          click: () => {
            changeWords((w) => ({ ...w, size: clampSize(sign > 0 ? w.size * 1.12 : w.size / 1.12) }), { key: `word-size-${selected}`, quiet: true });
            const now = title(store.doc)!;
            const w = now.words[targets[0] ?? 0];
            const px = `${Math.round(w?.size ?? 0)} px`;
            sizeValue.textContent = px;
            announce(editing ? `Palabra ${editing.text}: ${px}` : `Todas las palabras: ${px}`);
          },
        },
      },
      label,
    );

  const wordEditor = t.words.length
    ? h(
        "section",
        { class: "group" },
        h("h2", {}, editing ? `Palabra «${editing.text}»` : "Todas las palabras"),
        h(
          "div",
          { class: "row stepper" },
          resize(-1, "Letra más chica"),
          sizeValue,
          resize(1, "Letra más grande"),
        ),
        h("h3", {}, "Color"),
        h(
          "div",
          { class: "row wrap" },
          swatchRow(fill?.type === "solid" ? fill.color : "", (color) => changeWords((w) => ({ ...w, fill: { type: "solid", color } }))),
          ...GRADIENTS.map((g) =>
            swatch(
              `Degradado ${g.name.toLowerCase()}`,
              g.fill.type === "gradient" ? `linear-gradient(${g.fill.from}, ${g.fill.to})` : "",
              Boolean(fill && sameFill(fill, g.fill)),
              true,
              () => changeWords((w) => ({ ...w, fill: g.fill })),
            ),
          ),
        ),
        h("h3", {}, "Caja detrás"),
        h(
          "div",
          { class: "chips", role: "group", "aria-label": "Caja detrás" },
          ...BOXES.map((b) =>
            h(
              "button",
              {
                type: "button",
                class: `chip${box === b.color ? " active" : ""}`,
                "aria-pressed": String(box === b.color),
                on: {
                  click: () => {
                    changeWords((w) => ({ ...w, box: b.color ? { color: b.color } : null }));
                    announce(b.color ? `Caja ${b.name.toLowerCase()}` : "Sin caja");
                  },
                },
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
              h("span", {}, "Empezar una línea nueva con esta palabra"),
            )
          : null,
      )
    : null;

  const align = h(
    "div",
    { class: "segmented", role: "group", "aria-label": "Alineación" },
    ...ALIGNS.map((a) =>
      h(
        "button",
        {
          type: "button",
          class: t.align === a.align ? "active" : "",
          "aria-pressed": String(t.align === a.align),
          on: {
            click: () => {
              change((tl) => ({ ...tl, align: a.align }));
              announce(`Alineado: ${a.name.toLowerCase()}`);
            },
          },
        },
        a.name,
      ),
    ),
  );

  const block = () => {
    const current = title(store.doc)!;
    const layout = layoutTitle(current.words, current.align, metrics);
    return { width: layout.width, height: layout.height };
  };

  return h(
    "div",
    { class: "panel-body" },
    h("label", { class: "field-label", for: "title-text" }, "Título del episodio"),
    input,
    hint,
    advanced(
      "title",
      h("h2", {}, "Estilo"),
      presets,
      h("h2", {}, "Palabras"),
      h("p", { class: "muted" }, "Elige una palabra para cambiarla sola."),
      words,
      wordEditor,
      h("section", { class: "group" }, h("h2", {}, "Alineación"), align),
      h("section", { class: "group" }, h("h2", {}, "Tamaño y orden"), placementControls(store, t.id, block)),
      effectsEditor(t.effects, "title", (effects, options) => change((tl) => ({ ...tl, effects }), options)),
    ),
  );
}
