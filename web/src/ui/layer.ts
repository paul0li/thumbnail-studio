// «Capa»: what can be done to the selected photo.

import { canReorder, findLayer, flipLayer, removeLayer, reorder, setEffects } from "../document/edit";
import type { Store } from "../store";
import { h } from "./dom";
import { effectsEditor } from "./effects";

export function layerPanel(store: Store): HTMLElement {
  const id = store.selection?.layerId;
  const layer = id ? findLayer(store.doc, id) : undefined;
  if (!layer || (layer.kind !== "person" && layer.kind !== "logo")) {
    return h(
      "div",
      { class: "panel-body" },
      h("p", { class: "muted" }, "Toca una persona o el logo en la miniatura para moverlo, agrandarlo o darle efectos."),
      h("p", { class: "muted" }, "Arrastra con un dedo; agranda con dos dedos o desde una esquina."),
    );
  }
  const name = layer.kind === "person" ? "Persona" : "Logo";
  const button = (label: string, enabled: boolean, action: () => void) =>
    h("button", { class: "button", disabled: !enabled, on: { click: action } }, label);

  return h(
    "div",
    { class: "panel-body" },
    h("h3", {}, name),
    h(
      "div",
      { class: "row wrap" },
      layer.kind === "person" ? button("Voltear", true, () => store.commit(flipLayer(store.doc, layer.id))) : null,
      button("Adelante", canReorder(store.doc, layer.id, 1), () => store.commit(reorder(store.doc, layer.id, 1))),
      button("Atrás", canReorder(store.doc, layer.id, -1), () => store.commit(reorder(store.doc, layer.id, -1))),
      h("button", { class: "button danger", on: { click: () => store.commit(removeLayer(store.doc, layer.id)) } }, "Quitar"),
    ),
    effectsEditor(layer.effects, layer.kind, (effects, options) => store.commit(setEffects(store.doc, layer.id, effects), options)),
  );
}
