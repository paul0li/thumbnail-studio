// The «done» screen, and where a thumbnail opens from «Mis miniaturas».
// A thumbnail that «Mejorar» improved keeps that picture (ADR 0011): the done
// screen shows it with one thing to do, «Descargar de nuevo», and says
// plainly when it was made before her latest changes.

import type { Improvement, KeptImprovement } from "../api";

/** What was downloaded from this screen in this visit, if anything. */
export type Downloaded = "improved" | "mine" | null;

export interface DoneWords {
  /** The improved picture is shown, and downloaded by the primary button. */
  improved: boolean;
  /** It was made from an older version than the one on screen. */
  stale: string | null;
  text: string;
  primary: string;
}

const TOMORROW = "Para mañana, toca «Hacer una nueva»: el marco y el conductor ya van puestos.";

export function doneWords(o: { kept: Pick<KeptImprovement, "version"> | null; version: number | null; downloaded: Downloaded }): DoneWords {
  // Right after downloading her own, the screen is about her own.
  if (!o.kept || o.downloaded === "mine") {
    return { improved: false, stale: null, text: `Quedó en tu teléfono y en «Mis miniaturas». ${TOMORROW}`, primary: "Descargar otra vez" };
  }
  return {
    improved: true,
    stale: o.kept.version !== o.version ? "Mejorada antes de tus últimos cambios" : null,
    text:
      o.downloaded === "improved"
        ? `Quedó la mejorada en tu teléfono y en «Mis miniaturas». ${TOMORROW}`
        : `La mejorada quedó guardada en «Mis miniaturas». ${TOMORROW}`,
    primary: "Descargar de nuevo",
  };
}

/** Where a thumbnail opens when she taps it in «Mis miniaturas», or null for
 *  where she left it. A run of this version still going, or one that failed
 *  while she was away, is shown; otherwise an improved picture opens on the
 *  done screen. */
export function reopenView(o: { kept: boolean; run: Improvement["status"] | null; left: string | null }): "improve" | "done" | null {
  if (o.run === "running") return "improve";
  if (o.run === "failed" && o.left === "improve") return "improve";
  return o.kept ? "done" : null;
}

export function keptFrom(improvement: Improvement): KeptImprovement | null {
  if (improvement.status !== "ready" || !improvement.final_url) return null;
  return {
    id: improvement.id,
    version: improvement.version,
    url: improvement.final_url,
    finished_at: improvement.finished_at,
    chosen: improvement.chosen,
  };
}
