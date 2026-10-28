// «Mis miniaturas»: the recent thumbnails, newest first, one per row and
// large. At phone width two 16:9 thumbnails side by side are too small to tell
// apart, and telling them apart is the whole job of this screen.

import type { ThumbnailSummary } from "../api";
import { SAMPLE_TITLE } from "../document/edit";
import { h } from "./dom";

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** «Hoy, 10:42», «Ayer, 18:05», «Lunes, 26 de octubre». */
export function when(iso: string, now: Date = new Date()): string {
  const text = describeDay(iso, now);
  return text.charAt(0).toLocaleUpperCase("es") + text.slice(1);
}

function describeDay(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  const time = date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `Hoy, ${time}`;
  if (days === 1) return `Ayer, ${time}`;
  return date.toLocaleDateString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** What a thumbnail is called in the list. */
export function displayTitle(summary: Pick<ThumbnailSummary, "title">): string {
  const title = summary.title.trim();
  return !title || title === SAMPLE_TITLE ? "Sin título todavía" : title;
}

export interface HistoryOptions {
  thumbnails: ThumbnailSummary[] | null;
  /** The one open in the editor. */
  currentId: string;
  /** Why the list could not be loaded, if it could not. */
  error: string | null;
  open: (id: string) => void;
  startNew: () => void;
  retry: () => void;
}

export function historyPanel(o: HistoryOptions): HTMLElement {
  const list =
    o.thumbnails === null
      ? o.error
        ? h(
            "div",
            { class: "note", role: "alert" },
            o.error,
            " ",
            h("button", { type: "button", class: "link", on: { click: o.retry } }, "Volver a intentar"),
          )
        : h("p", { class: "muted" }, "Cargando…")
      : o.thumbnails.length === 0
        ? h("p", { class: "note" }, "Todavía no hay miniaturas guardadas.")
        : h(
            "ul",
            { class: "history", role: "list" },
            ...o.thumbnails.map((t) => {
              const current = t.id === o.currentId;
              const title = displayTitle(t);
              return h(
                "li",
                {},
                h(
                  "button",
                  {
                    type: "button",
                    class: `history-card${current ? " current" : ""}`,
                    "aria-current": current ? "true" : false,
                    on: { click: () => o.open(t.id) },
                  },
                  t.preview_url
                    ? h("img", { src: t.preview_url, alt: "", loading: "lazy", decoding: "async", width: "640", height: "360" })
                    : h("span", { class: "history-blank", "aria-hidden": "true" }, "Sin vista previa"),
                  h(
                    "span",
                    { class: "history-text" },
                    h("span", { class: "history-title" }, title),
                    h("span", { class: "history-when" }, when(t.updated_at)),
                    h(
                      "span",
                      { class: "history-tags" },
                      current ? h("span", { class: "tag" }, "Abierta ahora") : null,
                      t.downloaded ? h("span", { class: "tag" }, "✓ Descargada") : null,
                    ),
                  ),
                ),
              );
            }),
          );
  return h(
    "div",
    { class: "panel-body" },
    h("h1", { tabindex: "-1" }, "Mis miniaturas"),
    h("p", { class: "muted" }, "Toca una para abrirla. Se guardan solas mientras las haces."),
    h("div", { class: "row" }, h("button", { type: "button", class: "button primary", on: { click: o.startNew } }, "Hacer una nueva")),
    list,
  );
}
