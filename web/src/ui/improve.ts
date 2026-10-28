// «Mejorar»: the wait, the one result, or why there is none (ADR 0010).
// The wait says what is being done, in order, and how long it has been:
// there is no percentage, because nobody knows one. Screen readers hear each
// new step once (main.ts announces it), not the clock.

import type { Improvement, ImprovementStage } from "../api";
import { h } from "./dom";

export type ImproveState =
  | { kind: "sending" }
  | { kind: "running"; improvement: Improvement }
  | { kind: "ready"; improvement: Improvement }
  | { kind: "failed"; reason: string };

const STAGES: readonly { id: ImprovementStage; label: string }[] = [
  { id: "engine", label: "La IA rehace la luz, el fondo y el título" },
  { id: "faces", label: "Se devuelven las caras originales" },
  { id: "checks", label: "Se revisa que el título y las personas estén bien" },
  { id: "frame", label: "Se pone el marco" },
];

/** Each step of a run, and whether it is done, happening now or to come. */
export function stageItems(stage: ImprovementStage | null): { label: string; state: "done" | "current" | "todo" }[] {
  const at = stage === null ? -1 : stage === "done" ? STAGES.length : STAGES.findIndex((s) => s.id === stage);
  return STAGES.map((s, i) => ({ label: s.label, state: i < at ? "done" : i === at ? "current" : "todo" }));
}

/** «0:45», «1:02». */
export function elapsed(fromIso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export interface ImproveActions {
  use: () => void;
  keepMine: () => void;
  retry: () => void;
  downloadMine: () => void;
}

function waiting(state: Extract<ImproveState, { kind: "sending" | "running" }>): HTMLElement {
  const stage = state.kind === "running" ? state.improvement.stage : null;
  const items = stageItems(stage);
  return h(
    "div",
    { class: "panel-body" },
    h("h1", { tabindex: "-1" }, "Mejorando la miniatura"),
    h(
      "p",
      {},
      "Suele tardar uno o dos minutos. Sigue aunque cierres esta pantalla; al volver, aquí estará el resultado.",
    ),
    h(
      "ol",
      { class: "improve-steps", "aria-label": "Qué se está haciendo" },
      h(
        "li",
        { class: state.kind === "sending" ? "current" : "done", "aria-current": state.kind === "sending" ? "step" : false },
        h("span", { class: "improve-mark", "aria-hidden": "true" }, state.kind === "sending" ? "…" : "✓"),
        "Se envía tu escena, sin el marco",
      ),
      ...items.map((item) =>
        h(
          "li",
          { class: item.state, "aria-current": item.state === "current" ? "step" : false },
          h("span", { class: "improve-mark", "aria-hidden": "true" }, item.state === "done" ? "✓" : item.state === "current" ? "…" : ""),
          item.label,
          item.state === "done" ? h("span", { class: "visually-hidden" }, ", hecho") : null,
        ),
      ),
    ),
    state.kind === "running"
      ? h("p", { class: "muted", "aria-hidden": "true" }, `Lleva ${elapsed(state.improvement.created_at)}.`)
      : null,
  );
}

function result(improvement: Improvement, actions: ImproveActions): HTMLElement {
  return h(
    "div",
    { class: "panel-body" },
    h("h1", { tabindex: "-1" }, "¿Usas la mejorada?"),
    h("p", { class: "muted" }, "Arriba está la tuya. Esta es la mejorada:"),
    h("img", {
      class: "improved",
      src: improvement.final_url ?? "",
      alt: "La miniatura mejorada por la IA, con el marco del programa.",
      width: "1280",
      height: "720",
    }),
    h(
      "div",
      { class: "row two" },
      h("button", { type: "button", class: "button primary", on: { click: actions.use } }, "Usar esta"),
      h("button", { type: "button", class: "button", on: { click: actions.keepMine } }, "Volver atrás"),
    ),
  );
}

function failure(reason: string, actions: ImproveActions): HTMLElement {
  return h(
    "div",
    { class: "panel-body" },
    h("h1", { tabindex: "-1" }, "No se pudo mejorar"),
    h("div", { class: "note failure", role: "alert" }, h("strong", {}, "Por qué: "), reason),
    h("p", {}, "Tu miniatura quedó tal como la dejaste, y la puedes descargar."),
    h(
      "div",
      { class: "row two" },
      h("button", { type: "button", class: "button primary", on: { click: actions.downloadMine } }, "Descargar la mía"),
      h("button", { type: "button", class: "button", on: { click: actions.retry } }, "Volver a intentar"),
    ),
  );
}

export function improvePanel(state: ImproveState, actions: ImproveActions): HTMLElement {
  switch (state.kind) {
    case "sending":
    case "running":
      return waiting(state);
    case "ready":
      return result(state.improvement, actions);
    case "failed":
      return failure(state.reason, actions);
  }
}
