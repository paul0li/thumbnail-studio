// «Fotos»: the library by role. Tapping a photo puts it in the thumbnail.

import { ApiError, cutOut, deletePhoto, photoRef, uploadPhotos, type Config, type Photo, type Role } from "../api";
import {
  addPerson,
  background,
  flipLayer,
  photosInUse,
  replacePhoto,
  setBackgroundPhoto,
  setBackgroundTone,
  setFrame,
  setLogo,
} from "../document/edit";
import type { Store } from "../store";
import { h, toast } from "./dom";

const ROLE_LABELS: Record<Role, string> = {
  background: "Fondo",
  person: "Personas",
  logo: "Logo",
  frame: "Marco",
};

const ROLE_HINTS: Record<Role, string> = {
  background: "Se ve a sangre completa detrás de todo.",
  person: "Toca una foto para ponerla en la miniatura. Puedes poner varias.",
  logo: "Va encima de las fotos y se puede mover.",
  frame: "Va siempre encima de todo, a sangre completa.",
};

export interface LibraryState {
  role: Role;
  photos: Photo[];
  config: Config | null;
  busy: string | null;
}

export function libraryPanel(store: Store, state: LibraryState, refresh: () => Promise<void>, rerender: () => void): HTMLElement {
  const role = state.role;
  const inUse = photosInUse(store.doc);
  const photos = state.photos.filter((p) => p.role === role);
  const cutoutReady = Boolean(state.config?.cutout.available);

  const use = (photo: Photo) => {
    const ref = photoRef(photo);
    let doc = store.doc;
    if (role === "background") doc = setBackgroundPhoto(doc, ref);
    if (role === "person") doc = addPerson(doc, ref);
    if (role === "logo") doc = setLogo(doc, ref);
    if (role === "frame") doc = setFrame(doc, ref);
    store.commit(doc);
    if (role === "person") {
      const added = store.doc.layers.filter((l) => l.kind === "person").at(-1);
      if (added) store.select({ layerId: added.id, word: null });
    }
  };

  const upload = async (files: File[]) => {
    if (!files.length) return;
    state.busy = files.length === 1 ? "Subiendo la foto…" : `Subiendo ${files.length} fotos…`;
    rerender();
    try {
      const result = await uploadPhotos(role, files);
      for (const e of result.errors) toast(`${e.filename ?? "Archivo"}: ${e.detail}`);
      if (result.photos.length) toast(result.photos.length === 1 ? "Foto subida." : `${result.photos.length} fotos subidas.`);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "No se pudo subir. ¿Hay conexión?");
    } finally {
      state.busy = null;
      await refresh();
    }
  };

  const tabs = h(
    "div",
    { class: "segmented", role: "tablist" },
    ...(Object.keys(ROLE_LABELS) as Role[]).map((r) =>
      h(
        "button",
        {
          role: "tab",
          "aria-selected": String(r === role),
          class: r === role ? "active" : "",
          on: {
            click: () => {
              state.role = r;
              rerender();
            },
          },
        },
        ROLE_LABELS[r],
      ),
    ),
  );

  const input = h("input", {
    type: "file",
    accept: "image/png,image/jpeg,image/webp",
    multiple: true,
    hidden: true,
    on: {
      change: (event: Event) => {
        const target = event.target as HTMLInputElement;
        void upload(Array.from(target.files ?? []));
        target.value = "";
      },
    },
  });
  const uploadButton = h(
    "label",
    { class: `button primary${state.busy ? " disabled" : ""}` },
    state.busy ?? `Subir ${role === "person" ? "fotos" : "foto"}`,
    input,
  );

  const extras: HTMLElement[] = [];
  if (role === "background") {
    const bg = background(store.doc);
    extras.push(
      h(
        "div",
        { class: "chips" },
        h("button", { class: `chip${!bg.photo && bg.tone === "dark" ? " active" : ""}`, on: { click: () => store.commit(setBackgroundTone(setBackgroundPhoto(store.doc, null), "dark")) } }, "Sin foto: oscuro"),
        h("button", { class: `chip${!bg.photo && bg.tone === "light" ? " active" : ""}`, on: { click: () => store.commit(setBackgroundTone(setBackgroundPhoto(store.doc, null), "light")) } }, "Sin foto: claro"),
        bg.photo ? h("button", { class: "chip", on: { click: () => store.commit(flipLayer(store.doc, bg.id)) } }, "Voltear fondo") : null,
      ),
    );
  }
  if (role === "logo" && store.doc.layers.some((l) => l.kind === "logo")) {
    extras.push(h("div", { class: "chips" }, h("button", { class: "chip", on: { click: () => store.commit(setLogo(store.doc, null)) } }, "Quitar el logo")));
  }
  if (role === "frame" && store.doc.layers.some((l) => l.kind === "frame")) {
    extras.push(h("div", { class: "chips" }, h("button", { class: "chip", on: { click: () => store.commit(setFrame(store.doc, null)) } }, "Quitar el marco")));
  }
  if (role === "person" && !cutoutReady) {
    extras.push(
      h("p", { class: "note" }, "El recorte automático no está activo en este equipo: sube fotos ya recortadas (PNG con fondo transparente)."),
    );
  }

  const grid = photos.length
    ? h(
        "div",
        { class: "grid" },
        ...photos.map((photo) =>
          h(
            "div",
            { class: `tile${inUse.has(photo.id) ? " in-use" : ""}${role === "person" ? " checker" : ""}` },
            h(
              "button",
              { class: "tile-use", "aria-label": "Usar esta foto", on: { click: () => use(photo) } },
              h("img", { src: photo.url, alt: "", loading: "lazy", decoding: "async" }),
              inUse.has(photo.id) ? h("span", { class: "badge" }, "En uso") : null,
            ),
            h(
              "button",
              { class: "tile-more", "aria-label": "Más opciones", on: { click: () => openPhotoSheet(photo, cutoutReady, () => use(photo), refresh, (cut) => store.commit(replacePhoto(store.doc, photoRef(cut)))) } },
              "⋯",
            ),
          ),
        ),
      )
    : h("p", { class: "muted" }, "Todavía no hay fotos aquí.");

  return h(
    "div",
    { class: "panel-body" },
    tabs,
    h("p", { class: "muted" }, ROLE_HINTS[role]),
    h("div", { class: "row" }, uploadButton),
    ...extras,
    grid,
  );
}

function openPhotoSheet(
  photo: Photo,
  cutoutReady: boolean,
  use: () => void,
  refresh: () => Promise<void>,
  onCutOut: (photo: Photo) => void,
): void {
  const dialog = h("dialog", { class: "sheet" });
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  const actions: HTMLElement[] = [
    h("button", { class: "button primary", on: { click: () => { use(); close(); } } }, "Usar en la miniatura"),
  ];
  if (photo.role === "person") {
    if (!cutoutReady) {
      actions.push(h("p", { class: "note" }, "El recorte automático no está activo en este equipo."));
    } else if (photo.cut_out) {
      actions.push(h("p", { class: "note" }, "Esta foto ya está recortada."));
    } else {
      const button = h("button", { class: "button" }, "Quitar el fondo");
      button.addEventListener("click", async () => {
        button.textContent = "Recortando…";
        button.setAttribute("disabled", "");
        try {
          onCutOut(await cutOut(photo.id));
          toast("Fondo quitado.");
          close();
          await refresh();
        } catch (error) {
          toast(error instanceof ApiError ? error.message : "No se pudo recortar.");
          button.textContent = "Quitar el fondo";
          button.removeAttribute("disabled");
        }
      });
      actions.push(button);
    }
  }
  actions.push(
    h(
      "button",
      {
        class: "button danger",
        on: {
          click: async () => {
            if (!window.confirm("¿Eliminar esta foto de la librería? Las miniaturas que ya la usan la conservan.")) return;
            try {
              await deletePhoto(photo.id);
              toast("Foto eliminada.");
            } catch (error) {
              toast(error instanceof ApiError ? error.message : "No se pudo eliminar.");
            }
            close();
            await refresh();
          },
        },
      },
      "Eliminar de la librería",
    ),
    h("button", { class: "button ghost", on: { click: close } }, "Cerrar"),
  );
  dialog.append(
    h("div", { class: `sheet-preview${photo.role === "person" ? " checker" : ""}` }, h("img", { src: photo.url, alt: "" })),
    ...actions,
  );
  dialog.addEventListener("cancel", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
