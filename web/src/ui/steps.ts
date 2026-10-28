// The daily routine as four steps, each with one question and one choice.
// Everything else is in «Edición avanzada», closed.

import { photoRef, type Photo } from "../api";
import {
  background,
  flipLayer,
  people,
  photosInUse,
  removeLayer,
  replacePhoto,
  setBackgroundPhoto,
  setBackgroundTone,
  setEffects,
  setFrame,
  setHost,
  setLogo,
  title,
  toggleGuest,
} from "../document/edit";
import type { Metrics } from "../document/layout";
import type { PersonLayer } from "../document/types";
import type { Store } from "../store";
import { layerName } from "./describe";
import { advanced, announce, h, toast } from "./dom";
import { effectsEditor } from "./effects";
import { photoGrid, uploadButton, type LibraryState } from "./library";
import { placementControls } from "./placement";
import { titlePanel } from "./title";
import { isTitleDone } from "./progress";

export type StepId = "host" | "guests" | "background" | "title";

export interface Step {
  id: StepId;
  /** The short name in the progress list. */
  label: string;
  /** The one question the step asks. */
  question: string;
  optional?: boolean;
}

export const STEPS: readonly Step[] = [
  { id: "host", label: "Conductor", question: "¿Quién conduce hoy?" },
  { id: "guests", label: "Invitados", question: "¿Quién viene hoy?", optional: true },
  { id: "background", label: "Fondo", question: "¿Qué fondo va hoy?" },
  { id: "title", label: "Título", question: "¿Cómo se llama el episodio?" },
];

export interface StepContext {
  store: Store;
  library: LibraryState;
  metrics: Metrics;
  rerender: () => void;
  refresh: () => Promise<void>;
}

const cutOutInPlace = (store: Store) => (cut: Photo) => store.commit(replacePhoto(store.doc, photoRef(cut)));

/** Flip, remove, size, order and effects for one person, for the advanced section. */
function personControls(store: Store, layer: PersonLayer): HTMLElement {
  const name = layerName(store.doc, layer);
  return h(
    "section",
    { class: "group", "aria-label": name },
    h("h2", {}, name),
    h(
      "div",
      { class: "row two" },
      h(
        "button",
        {
          type: "button",
          class: "button",
          on: {
            click: () => {
              store.commit(flipLayer(store.doc, layer.id));
              announce(`${name}: en espejo`);
            },
          },
        },
        "Poner en espejo",
      ),
      h(
        "button",
        {
          type: "button",
          class: "button danger",
          on: {
            click: () => {
              store.commit(removeLayer(store.doc, layer.id));
              // «Deshacer» is always in the bottom bar: say so, with no timer to beat.
              toast(`${name} quitado. «Deshacer» lo devuelve.`);
            },
          },
        },
        "Quitar de la miniatura",
      ),
    ),
    placementControls(store, layer.id),
    effectsEditor(layer.effects, "person", (effects, options) => store.commit(setEffects(store.doc, layer.id, effects), options)),
  );
}

function hostStep(c: StepContext): HTMLElement[] {
  const { store } = c;
  const host = people(store.doc, "host")[0];
  return [
    h("p", { class: "muted" }, "Toca su foto. Queda a la derecha."),
    photoGrid(
      c.library,
      {
        role: "host",
        chosen: new Set(host ? [host.photo.photoId] : []),
        verb: "Conductor",
        empty: "Todavía no hay fotos de conductores. Sube una para empezar.",
        pick: (photo) => {
          store.commit(setHost(store.doc, photoRef(photo)));
          announce("Conductor elegido. Sigue con «Siguiente».");
        },
        onCutOut: cutOutInPlace(store),
      },
      c.refresh,
    ),
    uploadButton(c.library, "host", c.rerender, c.refresh),
    advanced("host", host ? personControls(store, host) : h("p", { class: "muted" }, "Elige primero al conductor.")),
  ];
}

function guestsStep(c: StepContext): HTMLElement[] {
  const { store } = c;
  const guests = people(store.doc, "guest");
  const host = people(store.doc, "host")[0];
  return [
    h(
      "p",
      { class: "muted", "aria-live": "polite" },
      guests.length === 0
        ? "Toca a una o dos personas. Si hoy no hay invitados, sigue."
        : guests.length === 1
          ? "1 invitado elegido. Toca otra foto para sumar uno más, o sigue."
          : `${guests.length} invitados elegidos. Toca una foto elegida para quitarla.`,
    ),
    photoGrid(
      c.library,
      {
        role: "guest",
        chosen: new Set(guests.map((g) => g.photo.photoId)),
        verb: "Invitado",
        empty: "Todavía no hay fotos de invitados. Sube una o dos para empezar.",
        pick: (photo) => {
          if (host?.photo.photoId === photo.id) {
            announce("Esa foto ya es la del conductor.");
            return;
          }
          const before = people(store.doc, "guest").length;
          store.commit(toggleGuest(store.doc, photoRef(photo)));
          const after = people(store.doc, "guest").length;
          announce(after > before ? `Invitado puesto. Van ${after}.` : `Invitado quitado. Van ${after}.`);
        },
        onCutOut: cutOutInPlace(store),
      },
      c.refresh,
    ),
    uploadButton(c.library, "guest", c.rerender, c.refresh),
    advanced(
      "guests",
      ...(guests.length ? guests.map((g) => personControls(store, g)) : [h("p", { class: "muted" }, "Elige primero a los invitados.")]),
    ),
  ];
}

function backgroundStep(c: StepContext): HTMLElement[] {
  const { store } = c;
  const bg = background(store.doc);
  const inUse = photosInUse(store.doc);
  const brandGrid = (role: "frame" | "logo") =>
    photoGrid(
      c.library,
      {
        role,
        chosen: new Set([...inUse].filter((id) => c.library.photos.some((p) => p.id === id && p.role === role))),
        verb: role === "frame" ? "Marco" : "Logo",
        empty: role === "frame" ? "No hay marcos en la librería." : "No hay logos en la librería.",
        pick: (photo) => {
          const on = inUse.has(photo.id);
          const ref = photoRef(photo);
          store.commit(role === "frame" ? setFrame(store.doc, on ? null : ref) : setLogo(store.doc, on ? null : ref));
          announce(on ? `${role === "frame" ? "Marco" : "Logo"} quitado` : `${role === "frame" ? "Marco" : "Logo"} puesto`);
        },
        onCutOut: cutOutInPlace(store),
      },
      c.refresh,
    );
  return [
    h("p", { class: "muted" }, "Toca una foto. Se ve detrás de todo."),
    photoGrid(
      c.library,
      {
        role: "background",
        chosen: new Set(bg.photo ? [bg.photo.photoId] : []),
        verb: "Fondo",
        empty: "Todavía no hay fondos. Sube una foto para empezar.",
        pick: (photo) => {
          store.commit(setBackgroundPhoto(store.doc, photoRef(photo)));
          announce("Fondo elegido. Sigue con «Siguiente».");
        },
        onCutOut: cutOutInPlace(store),
      },
      c.refresh,
    ),
    uploadButton(c.library, "background", c.rerender, c.refresh),
    advanced(
      "background",
      h("h2", {}, "Fondo sin foto"),
      h(
        "div",
        { class: "chips" },
        ...(["dark", "light"] as const).map((tone) =>
          h(
            "button",
            {
              type: "button",
              class: `chip${!bg.photo && bg.tone === tone ? " active" : ""}`,
              "aria-pressed": String(!bg.photo && bg.tone === tone),
              on: {
                click: () => {
                  store.commit(setBackgroundTone(setBackgroundPhoto(store.doc, null), tone));
                  announce(tone === "dark" ? "Fondo oscuro sin foto" : "Fondo claro sin foto");
                },
              },
            },
            tone === "dark" ? "Oscuro" : "Claro",
          ),
        ),
        bg.photo
          ? h(
              "button",
              {
                type: "button",
                class: "chip",
                on: {
                  click: () => {
                    store.commit(flipLayer(store.doc, bg.id));
                    announce("Fondo en espejo");
                  },
                },
              },
              "Poner el fondo en espejo",
            )
          : null,
      ),
      h("h2", {}, "Marco"),
      h("p", { class: "muted" }, "El marco del programa se pone solo en cada miniatura nueva."),
      brandGrid("frame"),
      uploadButton(c.library, "frame", c.rerender, c.refresh),
      h("h2", {}, "Logo"),
      brandGrid("logo"),
      uploadButton(c.library, "logo", c.rerender, c.refresh),
    ),
  ];
}

function titleStep(c: StepContext): HTMLElement[] {
  return [titlePanel(c.store, c.metrics)];
}

export function stepPanel(id: StepId, c: StepContext): HTMLElement[] {
  switch (id) {
    case "host":
      return hostStep(c);
    case "guests":
      return guestsStep(c);
    case "background":
      return backgroundStep(c);
    case "title":
      return titleStep(c);
  }
}

/** Whether a step's choice is made, for the progress list. */
export function stepDone(id: StepId, store: Store): boolean {
  const doc = store.doc;
  switch (id) {
    case "host":
      return people(doc, "host").length > 0;
    case "guests":
      return people(doc, "guest").length > 0;
    case "background":
      return background(doc).photo !== null;
    case "title": {
      const t = title(doc);
      return Boolean(t && isTitleDone(t.text));
    }
  }
}
