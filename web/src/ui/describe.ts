// The thumbnail in words, for people who cannot see the canvas: a name for each
// layer and a description of where things are. Pure, so it is tested.

import { CANVAS_HEIGHT, CANVAS_WIDTH, type DesignDocument, type Layer } from "../document/types";

/** The name a layer goes by in buttons and announcements. */
export function layerName(doc: DesignDocument, layer: Layer): string {
  switch (layer.kind) {
    case "background":
      return "Fondo";
    case "frame":
      return "Marco";
    case "logo":
      return "Logo";
    case "title":
      return "Título";
    case "person": {
      if (layer.slot === "host") return "Conductor";
      const guests = doc.layers.filter((l) => l.kind === "person" && l.slot === "guest");
      return guests.length > 1 ? `Invitado ${guests.indexOf(layer) + 1}` : "Invitado";
    }
  }
}

/** Where a point is, in plain words: «arriba a la izquierda», «al centro». */
export function whereIs(x: number, y: number): string {
  const col = x < CANVAS_WIDTH / 3 ? "a la izquierda" : x > (2 * CANVAS_WIDTH) / 3 ? "a la derecha" : "al centro";
  const row = y < CANVAS_HEIGHT / 3 ? "arriba" : y > (2 * CANVAS_HEIGHT) / 3 ? "abajo" : "";
  if (!row) return col;
  return col === "al centro" ? `${row} al centro` : `${row} ${col}`;
}

/** One sentence per layer, front first, for the canvas's accessible description. */
export function describeDocument(doc: DesignDocument): string {
  const parts: string[] = [];
  for (const layer of [...doc.layers].reverse()) {
    switch (layer.kind) {
      case "frame":
        parts.push("Marco encima de todo.");
        break;
      case "title":
        parts.push(`Título: «${layer.text}».`);
        break;
      case "logo":
        parts.push(`Logo ${whereIs(layer.x, layer.y)}.`);
        break;
      case "person":
        parts.push(`${layerName(doc, layer)} ${whereIs(layer.x, layer.y)}${layer.flipX ? ", en espejo" : ""}.`);
        break;
      case "background":
        parts.push(layer.photo ? "Fondo con foto." : layer.tone === "dark" ? "Fondo oscuro sin foto." : "Fondo claro sin foto.");
        break;
    }
  }
  return parts.join(" ");
}
