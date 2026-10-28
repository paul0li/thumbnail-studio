import "./styles.css";
import { getConfig, listPhotos } from "./api";
import { loadFont } from "./canvas/fonts";
import { Scene } from "./canvas/scene";
import { findLayer } from "./document/edit";
import type { DesignDocument } from "./document/types";
import { validateDocument, type ValidationResult } from "./document/validate";
import { Store } from "./store";
import { describeDocument, layerName } from "./ui/describe";
import { announce, clear, h, keepFocus, toast } from "./ui/dom";
import type { LibraryState } from "./ui/library";
import { missing } from "./ui/progress";
import { startOfDay } from "./ui/routine";
import { STEPS, stepDone, stepPanel, type StepId } from "./ui/steps";

/** Which step was open survives a reload: a per-device convenience. */
const STEP_KEY = "thumbnail-studio:step:v1";
type View = StepId | "done";

function loadView(): View {
  try {
    const saved = window.localStorage.getItem(STEP_KEY);
    if (saved && (saved === "done" || STEPS.some((s) => s.id === saved))) return saved as View;
  } catch {
    // Storage blocked: start at the beginning.
  }
  return STEPS[0]!.id;
}

function saveView(view: View): void {
  try {
    window.localStorage.setItem(STEP_KEY, view);
  } catch {
    // Not important.
  }
}

async function exportBlob(scene: Scene): Promise<Blob> {
  const canvas = await scene.exportCanvas();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("export failed"))), "image/png"),
  );
}

/** On iOS the share sheet is the way to save an image; elsewhere, a download.
 *  Resolves false when the person closed the share sheet without saving. */
async function download(scene: Scene): Promise<boolean> {
  const blob = await exportBlob(scene);
  const file = new File([blob], "miniatura.png", { type: "image/png" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return false;
      // Fall through to a plain download.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: "miniatura.png" });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

async function main(): Promise<void> {
  const root = document.getElementById("app")!;
  root.append(h("p", { class: "loading" }, "Cargando…"));
  const metrics = await loadFont();
  const store = new Store();
  const library: LibraryState = { photos: [], config: null, busy: null };
  let view: View = store.fromDraft ? loadView() : STEPS[0]!.id;

  // The canvas is a picture: it is named, and described in words that follow
  // every change.
  const description = h("p", { id: "stage-description", class: "visually-hidden" });
  const stageBox = h("div", { class: "stage", role: "img", "aria-label": "Miniatura", "aria-describedby": "stage-description" });
  const progress = h("ol", { class: "steps", "aria-label": "Pasos" });
  const panel = h("main", { class: "panel", id: "panel", tabindex: "-1" });

  // The bottom bar: undo, back and the one next thing to do, under the thumb.
  const undo = h(
    "button",
    {
      type: "button",
      class: "bar-button",
      on: {
        click: () => {
          if (!store.canUndo()) {
            announce("No hay nada que deshacer.");
            return;
          }
          store.undo();
          announce("Deshecho.");
        },
      },
    },
    h("span", { "aria-hidden": "true", class: "bar-icon" }, "↶"),
    "Deshacer",
  );
  const back = h("button", { type: "button", class: "bar-button" });
  const next = h("button", { type: "button", class: "bar-button primary" });
  const nav = h("nav", { class: "bar", "aria-label": "Avanzar" }, undo, back, next);

  clear(root);
  root.append(
    h("header", { class: "top" }, progress),
    h("section", { class: "stage-wrap", "aria-label": "Vista previa" }, stageBox, description),
    panel,
    nav,
  );
  // The bar grows with larger text; the page keeps room for it.
  new ResizeObserver(() => {
    const html = document.documentElement;
    html.classList.toggle("large-text", parseFloat(getComputedStyle(html).fontSize) >= 24);
    html.style.setProperty("--tabs-h", `${nav.offsetHeight}px`);
  }).observe(nav);

  const scene = new Scene(stageBox, metrics, {
    // Tapping on the canvas selects for dragging; it never changes the step.
    select: (selection) => store.select(selection),
    change: (doc) => {
      // A rejected change puts the scene back to the document that stands.
      if (store.commit(doc).length) scene.setDocument(store.doc);
      const layer = store.selection ? findLayer(store.doc, store.selection.layerId) : undefined;
      if (layer) announce(`Movido: ${layerName(store.doc, layer)}`);
    },
  });

  const fit = () => scene.resize(stageBox.clientWidth);
  new ResizeObserver(fit).observe(stageBox);
  fit();

  const stepIndex = () => STEPS.findIndex((s) => s.id === view);

  function go(to: View): void {
    view = to;
    saveView(to);
    render();
    // Say where we are: focus the step's question, at the top of the panel.
    panel.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }

  let downloading = false;
  async function finish(): Promise<void> {
    if (downloading) return;
    downloading = true;
    next.setAttribute("aria-disabled", "true");
    announce("Preparando la imagen…");
    try {
      if (await download(scene)) go("done");
    } catch (error) {
      console.error(error);
      toast("No se pudo crear la imagen. Vuelve a intentarlo.", { error: true });
    } finally {
      downloading = false;
      next.removeAttribute("aria-disabled");
    }
  }

  function startNew(): void {
    store.commit(startOfDay(store.doc, library.photos));
    store.select(null);
    go(STEPS[0]!.id);
    toast("Miniatura nueva. «Deshacer» vuelve a la anterior.");
  }

  function renderProgress(): void {
    const index = stepIndex();
    progress.replaceChildren(
      ...STEPS.map((step, i) => {
        const done = stepDone(step.id, store);
        const current = i === index;
        return h(
          "li",
          {},
          h(
            "button",
            {
              type: "button",
              class: `step${current ? " current" : ""}${done ? " done" : ""}`,
              "aria-current": current ? "step" : false,
              on: { click: () => go(step.id) },
            },
            h("span", { class: "step-mark", "aria-hidden": "true" }, done ? "✓" : String(i + 1)),
            h("span", { class: "visually-hidden" }, `Paso ${i + 1}: `),
            h("span", { class: "step-label" }, step.label),
            done ? h("span", { class: "visually-hidden" }, ", hecho") : null,
          ),
        );
      }),
    );
  }

  function renderBar(): void {
    undo.setAttribute("aria-disabled", String(!store.canUndo()));
    const index = stepIndex();
    if (view === "done") {
      back.hidden = false;
      back.replaceChildren(h("span", { "aria-hidden": "true", class: "bar-icon" }, "←"), "Editar");
      back.onclick = () => go(STEPS[STEPS.length - 1]!.id);
      next.replaceChildren("Hacer una nueva");
      next.onclick = startNew;
      return;
    }
    back.hidden = index === 0;
    back.replaceChildren(h("span", { "aria-hidden": "true", class: "bar-icon" }, "←"), "Atrás");
    back.onclick = () => go(STEPS[index - 1]!.id);
    const last = index === STEPS.length - 1;
    next.replaceChildren(last ? "Descargar" : `Siguiente: ${STEPS[index + 1]!.label}`, h("span", { "aria-hidden": "true" }, last ? " ↓" : " →"));
    next.onclick = last ? () => void finish() : () => go(STEPS[index + 1]!.id);
  }

  function renderPanel(): void {
    const scroll = panel.scrollTop;
    keepFocus(panel, () => {
      if (view === "done") {
        panel.replaceChildren(
          h(
            "div",
            { class: "panel-body" },
            h("h1", { tabindex: "-1" }, "✓ Miniatura lista"),
            h("p", {}, "Quedó guardada en tu teléfono. Para mañana, toca «Hacer una nueva»: el marco y el conductor ya van puestos."),
            h("div", { class: "row" }, h("button", { type: "button", class: "button", on: { click: () => void finish() } }, "Descargar otra vez")),
          ),
        );
        return;
      }
      const index = stepIndex();
      const step = STEPS[index]!;
      const required = STEPS.filter((s) => !s.optional && !stepDone(s.id, store) && s.id !== step.id);
      const left = step.id === "title" ? missing(required.map((s) => s.label)) : null;
      panel.replaceChildren(
        h(
          "div",
          { class: "panel-body" },
          h("p", { class: "step-count" }, `Paso ${index + 1} de ${STEPS.length}${step.optional ? " · opcional" : ""}`),
          h("h1", { tabindex: "-1" }, step.question),
          ...stepPanel(step.id, { store, library, metrics, rerender: render, refresh: refreshLibrary }),
          left
            ? h(
                "div",
                { class: "note", role: "status" },
                left,
                " ",
                ...required.map((s) => h("button", { type: "button", class: "link", on: { click: () => go(s.id) } }, `Ir a ${s.label.toLowerCase()}`)),
              )
            : null,
        ),
      );
    });
    panel.scrollTop = scroll;
  }

  function render(): void {
    renderProgress();
    renderPanel();
    renderBar();
  }

  async function refreshLibrary(): Promise<void> {
    try {
      const [config, photos] = await Promise.all([library.config ? Promise.resolve(library.config) : getConfig(), listPhotos()]);
      library.config = config;
      library.photos = photos;
    } catch {
      toast("No se pudo cargar la librería. Revisa la conexión.", { error: true });
    }
    render();
  }

  const describe = () => (description.textContent = describeDocument(store.doc));
  store.subscribe((quiet) => {
    scene.setDocument(store.doc);
    scene.setSelection(store.selection);
    describe();
    if (quiet) {
      undo.setAttribute("aria-disabled", String(!store.canUndo()));
      renderProgress();
    } else render();
  });

  scene.setDocument(store.doc);
  describe();
  render();
  await refreshLibrary();
  // The first time on this device, the thumbnail starts with the show's frame.
  if (!store.fromDraft) store.begin(startOfDay(null, library.photos));

  // The seam for a headless render (ADR 0005): load a document and export it
  // from this same scene.
  (window as unknown as { studio: unknown }).studio = {
    document: (): DesignDocument => store.doc,
    load: (doc: unknown): ValidationResult => {
      const result = validateDocument(doc);
      if (result.ok) store.commit(result.document);
      return result;
    },
    exportPng: async (): Promise<string> => {
      const canvas = await scene.exportCanvas();
      return canvas.toDataURL("image/png");
    },
  };
}

void main();
