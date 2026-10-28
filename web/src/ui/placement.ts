// Size and order with buttons, for what pinching and stacking do on the
// canvas. They write the document through the same edits the gestures use.

import { canReorder, findLayer, reorder, scaleLayerStep, type BlockSize } from "../document/edit";
import type { Store } from "../store";
import { layerName } from "./describe";
import { announce, h } from "./dom";

/** `block` gives the title's size at scale 1; photos do not need it. */
export function placementControls(store: Store, layerId: string, block?: () => BlockSize): HTMLElement {
  const name = () => {
    const l = findLayer(store.doc, layerId);
    return l ? layerName(store.doc, l) : "";
  };

  const size = (step: 1 | -1, label: string) =>
    h(
      "button",
      {
        type: "button",
        class: "button",
        on: {
          click: () => {
            const next = scaleLayerStep(store.doc, layerId, step, block?.());
            if (next === store.doc) {
              announce(step > 0 ? "Ya está al tamaño máximo." : "Ya está al tamaño mínimo.");
              return;
            }
            // Taps in a row are one undo step; the panel stays, and so does the focus.
            store.commit(next, { key: `scale-${layerId}`, quiet: true });
            announce(`${label}: ${name()}`);
          },
        },
      },
      label,
    );

  const order = (step: 1 | -1, label: string) =>
    h(
      "button",
      {
        type: "button",
        class: "button",
        // Not `disabled`: a disabled button loses the focus when the panel is
        // redrawn, and says nothing when tapped.
        "aria-disabled": String(!canReorder(store.doc, layerId, step)),
        on: {
          click: () => {
            if (!canReorder(store.doc, layerId, step)) {
              announce(step > 0 ? "Ya está delante de todo." : "Ya está detrás de todo.");
              return;
            }
            store.commit(reorder(store.doc, layerId, step));
            announce(`${label}: ${name()}`);
          },
        },
      },
      label,
    );

  return h(
    "div",
    { class: "panel-body" },
    h("h3", {}, "Tamaño"),
    h("div", { class: "row two" }, size(-1, "Más chico"), size(1, "Más grande")),
    h("h3", {}, "Delante o detrás"),
    h("div", { class: "row two" }, order(-1, "Más atrás"), order(1, "Más adelante")),
  );
}
