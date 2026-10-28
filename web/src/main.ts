import "./styles.css";
import { getConfig, listPhotos } from "./api";
import { loadFont } from "./canvas/fonts";
import { Scene } from "./canvas/scene";
import { findLayer } from "./document/edit";
import type { DesignDocument } from "./document/types";
import { validateDocument, type ValidationResult } from "./document/validate";
import { Store } from "./store";
import { clear, h, toast } from "./ui/dom";
import { layerPanel } from "./ui/layer";
import { libraryPanel, type LibraryState } from "./ui/library";
import { titlePanel } from "./ui/title";

type Tab = "photos" | "title" | "layer";
const TABS: { id: Tab; label: string }[] = [
  { id: "photos", label: "Fotos" },
  { id: "title", label: "Título" },
  { id: "layer", label: "Capa" },
];

async function exportBlob(scene: Scene): Promise<Blob> {
  const canvas = await scene.exportCanvas();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("export failed"))), "image/png"),
  );
}

/** On iOS the share sheet is the way to save an image; elsewhere, a download. */
async function download(scene: Scene): Promise<void> {
  const blob = await exportBlob(scene);
  const file = new File([blob], "miniatura.png", { type: "image/png" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      // Fall through to a plain download.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: "miniatura.png" });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function main(): Promise<void> {
  const root = document.getElementById("app")!;
  root.append(h("p", { class: "loading" }, "Cargando…"));
  const metrics = await loadFont();
  const store = new Store();
  const library: LibraryState = { role: "person", photos: [], config: null, busy: null };
  let tab: Tab = "photos";

  const stageBox = h("div", { class: "stage" });
  const panel = h("main", { class: "panel" });
  const undo = h("button", { class: "button ghost small", on: { click: () => store.undo() } }, "Deshacer");
  const downloadButton = h("button", { class: "button primary small" }, "Descargar");
  downloadButton.addEventListener("click", async () => {
    downloadButton.setAttribute("disabled", "");
    try {
      await download(scene);
    } catch (error) {
      console.error(error);
      toast("No se pudo crear la imagen.");
    } finally {
      downloadButton.removeAttribute("disabled");
    }
  });
  const nav = h("nav", { class: "tabs" });

  clear(root);
  root.append(
    h("header", { class: "top" }, h("h1", {}, "Miniatura"), h("div", { class: "row" }, undo, downloadButton)),
    h("div", { class: "stage-wrap" }, stageBox),
    panel,
    nav,
  );

  const scene = new Scene(stageBox, metrics, {
    select: (selection) => {
      store.select(selection);
      if (!selection) return;
      const layer = findLayer(store.doc, selection.layerId);
      const next: Tab = layer?.kind === "title" ? "title" : "layer";
      if (next !== tab) {
        tab = next;
        renderPanel();
      }
    },
    change: (doc) => {
      // A rejected change puts the scene back to the document that stands.
      if (store.commit(doc).length) scene.setDocument(store.doc);
    },
  });

  const fit = () => scene.resize(stageBox.clientWidth);
  new ResizeObserver(fit).observe(stageBox);
  fit();

  function renderNav(): void {
    nav.replaceChildren(
      ...TABS.map((t) =>
        h(
          "button",
          {
            class: t.id === tab ? "active" : "",
            "aria-current": t.id === tab ? "page" : false,
            on: {
              click: () => {
                tab = t.id;
                renderPanel();
              },
            },
          },
          t.label,
        ),
      ),
    );
  }

  function renderPanel(): void {
    renderNav();
    const scroll = panel.scrollTop;
    const body =
      tab === "photos"
        ? libraryPanel(store, library, refreshLibrary, renderPanel)
        : tab === "title"
          ? titlePanel(store, metrics)
          : layerPanel(store);
    panel.replaceChildren(body);
    panel.scrollTop = scroll;
    undo.toggleAttribute("disabled", !store.canUndo());
  }

  async function refreshLibrary(): Promise<void> {
    try {
      const [config, photos] = await Promise.all([library.config ? Promise.resolve(library.config) : getConfig(), listPhotos()]);
      library.config = config;
      library.photos = photos;
    } catch {
      toast("No se pudo cargar la librería.");
    }
    if (tab === "photos") renderPanel();
  }

  store.subscribe((quiet) => {
    scene.setDocument(store.doc);
    scene.setSelection(store.selection);
    if (quiet) undo.toggleAttribute("disabled", !store.canUndo());
    else renderPanel();
  });

  scene.setDocument(store.doc);
  renderPanel();
  await refreshLibrary();

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
