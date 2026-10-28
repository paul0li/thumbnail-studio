// The photo library as the steps use it: a grid to pick from, a button to add
// a new photo, and a sheet with the rarer actions (cut out, delete).

import { ApiError, cutOut, deletePhoto, isPersonRole, setRole, uploadPhotos, type Config, type Photo, type Role } from "../api";
import { announce, h, toast } from "./dom";

export interface LibraryState {
  photos: Photo[];
  config: Config | null;
  /** What is uploading, said on the button while it lasts. */
  busy: string | null;
}

export interface GridOptions {
  role: Role;
  /** Photo ids that are in the thumbnail now. */
  chosen: ReadonlySet<string>;
  /** Tapping a photo. */
  pick: (photo: Photo) => void;
  /** Said on each tile, e.g. «Conductor». */
  verb: string;
  empty: string;
  /** After a cut-out, the thumbnail switches to the cut version. */
  onCutOut: (photo: Photo) => void;
}

export function photoGrid(state: LibraryState, options: GridOptions, refresh: () => Promise<void>): HTMLElement {
  const photos = state.photos.filter((p) => p.role === options.role);
  if (!photos.length) return h("p", { class: "note" }, options.empty);
  const cutoutReady = Boolean(state.config?.cutout.available);
  return h(
    "ul",
    { class: "grid", role: "list" },
    ...photos.map((photo, i) => {
      const chosen = options.chosen.has(photo.id);
      return h(
        "li",
        { class: `tile${chosen ? " in-use" : ""}${options.role !== "background" ? " checker" : ""}` },
        h(
          "button",
          {
            type: "button",
            class: "tile-use",
            "aria-pressed": String(chosen),
            on: { click: () => options.pick(photo) },
          },
          h("img", { src: photo.url, alt: `${options.verb}: foto ${i + 1}`, loading: "lazy", decoding: "async" }),
          chosen ? h("span", { class: "badge" }, "✓ Elegida") : null,
        ),
        h(
          "button",
          {
            type: "button",
            class: "tile-more",
            "data-photo": photo.id,
            "aria-label": `Opciones de la foto ${i + 1}`,
            "aria-haspopup": "dialog",
            on: { click: () => openPhotoSheet(photo, i + 1, cutoutReady, refresh, options.onCutOut) },
          },
          h("span", { "aria-hidden": "true" }, "⋯"),
        ),
      );
    }),
  );
}

/** «Subir una foto nueva»: a real button (a label is not reachable by keyboard
 *  and VoiceOver does not call it a button) that opens the file picker. */
export function uploadButton(
  state: LibraryState,
  role: Role,
  rerender: () => void,
  refresh: () => Promise<void>,
  onUploaded?: (photos: Photo[]) => void,
): HTMLElement {
  const input = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", multiple: role === "guest", hidden: true });
  input.addEventListener("change", async () => {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (!files.length) return;
    state.busy = files.length === 1 ? "Subiendo la foto…" : `Subiendo ${files.length} fotos…`;
    rerender();
    announce(state.busy);
    let uploaded: Photo[] = [];
    try {
      const result = await uploadPhotos(role, files);
      uploaded = result.photos;
      const failed = result.errors.map((e) => `${e.filename ?? "Archivo"}: ${e.detail}`);
      const done = uploaded.length ? (uploaded.length === 1 ? "Foto subida." : `${uploaded.length} fotos subidas.`) : "";
      if (failed.length) toast([done, `No se pudo subir: ${failed.join(" ")}`].filter(Boolean).join(" "), { error: true });
      else if (done) toast(done);
    } catch (error) {
      toast(
        error instanceof ApiError
          ? `No se pudo subir: ${error.message}`
          : "No se pudo subir la foto. Revisa la conexión y vuelve a intentarlo.",
        { error: true },
      );
    } finally {
      state.busy = null;
      await refresh();
    }
    if (uploaded.length) onUploaded?.(uploaded);
  });
  return h(
    "div",
    { class: "row" },
    h(
      "button",
      {
        type: "button",
        class: "button",
        "aria-disabled": String(Boolean(state.busy)),
        on: { click: () => (state.busy ? announce(state.busy) : input.click()) },
      },
      state.busy ?? (role === "guest" ? "Subir fotos nuevas" : "Subir una foto nueva"),
    ),
    input,
  );
}

function openPhotoSheet(
  photo: Photo,
  number: number,
  cutoutReady: boolean,
  refresh: () => Promise<void>,
  onCutOut: (photo: Photo) => void,
): void {
  const dialog = h("dialog", { class: "sheet", "aria-labelledby": "sheet-title" });
  const status = h("p", { class: "note", role: "status" });
  status.hidden = true;
  const say = (message: string) => {
    status.hidden = false;
    status.textContent = message;
  };
  const close = () => dialog.close();
  // Back to the «⋯» that opened it, found again in case the panel was redrawn.
  dialog.addEventListener("close", () => {
    dialog.remove();
    document.querySelector<HTMLElement>(`.tile-more[data-photo="${photo.id}"]`)?.focus();
  });
  const actions: HTMLElement[] = [];
  if (isPersonRole(photo.role)) {
    if (!cutoutReady) {
      actions.push(h("p", { class: "note" }, "Quitar el fondo no está disponible en este equipo. Sube una foto que ya venga recortada."));
    } else if (photo.cut_out) {
      actions.push(h("p", { class: "note" }, "Esta foto ya está recortada."));
    } else {
      const button = h("button", { type: "button", class: "button" }, "Quitar el fondo de la foto");
      button.addEventListener("click", async () => {
        if (button.getAttribute("aria-disabled") === "true") return;
        button.textContent = "Quitando el fondo…";
        button.setAttribute("aria-disabled", "true");
        say("Quitando el fondo. Puede tardar unos segundos.");
        try {
          onCutOut(await cutOut(photo.id));
          toast("Fondo quitado.");
          close();
          await refresh();
        } catch (error) {
          say(error instanceof ApiError ? `No se pudo quitar el fondo: ${error.message}` : "No se pudo quitar el fondo. Vuelve a intentarlo.");
          button.textContent = "Quitar el fondo de la foto";
          button.removeAttribute("aria-disabled");
        }
      });
      actions.push(button);
    }
  }
  if (isPersonRole(photo.role)) {
    const to = photo.role === "host" ? "guest" : "host";
    actions.push(
      h(
        "button",
        {
          type: "button",
          class: "button",
          on: {
            click: async () => {
              try {
                await setRole(photo.id, to);
                toast(to === "host" ? "Ahora está con los conductores." : "Ahora está con los invitados.");
                close();
              } catch (error) {
                say(error instanceof ApiError ? `No se pudo mover: ${error.message}` : "No se pudo mover. Vuelve a intentarlo.");
                return;
              }
              await refresh();
            },
          },
        },
        to === "host" ? "Mover a conductores" : "Mover a invitados",
      ),
    );
  }
  actions.push(
    h(
      "button",
      {
        type: "button",
        class: "button danger",
        on: {
          click: async () => {
            if (!window.confirm("¿Borrar esta foto de la librería? Las miniaturas que ya la usan la conservan.")) return;
            try {
              await deletePhoto(photo.id);
              toast("Foto borrada de la librería.");
              close();
            } catch (error) {
              say(error instanceof ApiError ? `No se pudo borrar: ${error.message}` : "No se pudo borrar. Vuelve a intentarlo.");
              return;
            }
            await refresh();
          },
        },
      },
      "Borrar de la librería",
    ),
    // The sheet opens on its safest button, never on «Borrar».
    h("button", { type: "button", class: "button ghost", autofocus: true, on: { click: close } }, "Cerrar"),
  );
  dialog.append(
    h("h2", { id: "sheet-title" }, `Foto ${number}`),
    h("div", { class: `sheet-preview${photo.role !== "background" ? " checker" : ""}` }, h("img", { src: photo.url, alt: "" })),
    status,
    ...actions,
  );
  document.body.append(dialog);
  dialog.showModal();
}
