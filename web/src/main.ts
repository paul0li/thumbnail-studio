import "./styles.css";
import {
  deleteThumbnail,
  duplicateThumbnail,
  getConfig,
  getThumbnail,
  listPhotos,
  listThumbnails,
  newThumbnailId,
  Offline,
  putPicture,
  setRole,
  type ThumbnailState,
  type ThumbnailSummary,
} from "./api";
import { loadFont } from "./canvas/fonts";
import { Scene } from "./canvas/scene";
import { findLayer, people } from "./document/edit";
import { CANVAS_HEIGHT, CANVAS_WIDTH, type DesignDocument } from "./document/types";
import { validateDocument, type ValidationResult } from "./document/validate";
import { fromServer, reconcile, type Start } from "./open";
import { Store } from "./store";
import { readLocal, Saver, type SyncStatus } from "./sync";
import { describeDocument, layerName } from "./ui/describe";
import { advanced, announce, clear, h, keepFocus, toast } from "./ui/dom";
import { historyPanel } from "./ui/history";
import type { LibraryState } from "./ui/library";
import { missing } from "./ui/progress";
import { startOfDay } from "./ui/routine";
import { STEPS, stepDone, stepPanel, type StepId } from "./ui/steps";

/** Which step was open, per thumbnail, survives a reload on this device. */
const STEP_KEY = "thumbnail-studio:step:v2";
/** The single draft kept by the version before thumbnails were saved. */
const LEGACY_DRAFT_KEY = "thumbnail-studio:draft:v1";
const PREVIEW_DELAY_MS = 2500;
const PREVIEW_WIDTH = 640;

type View = StepId | "done";
type Screen = "editor" | "history";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadView(id: string): View | null {
  try {
    const saved = JSON.parse(storage()?.getItem(STEP_KEY) ?? "null") as { id?: string; view?: string } | null;
    const view = saved?.view;
    if (saved?.id === id && view && (view === "done" || STEPS.some((s) => s.id === view))) return view as View;
  } catch {
    // Storage blocked or garbled: start at the beginning.
  }
  return null;
}

function saveView(id: string, view: View): void {
  try {
    storage()?.setItem(STEP_KEY, JSON.stringify({ id, view }));
  } catch {
    // Not important.
  }
}

/** The draft from before thumbnails were saved on the server, if this
 *  device has one. It becomes a saved thumbnail the first time. */
function takeLegacyDraft(): DesignDocument | null {
  try {
    const raw = storage()?.getItem(LEGACY_DRAFT_KEY);
    if (!raw) return null;
    const result = validateDocument(JSON.parse(raw));
    return result.ok ? result.document : null;
  } catch {
    return null;
  }
}

function forgetLegacyDraft(): void {
  try {
    storage()?.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    // Not important.
  }
}

function routeId(): string | null {
  const match = /^#\/m\/([A-Za-z0-9_-]{8,64})$/.exec(window.location.hash);
  return match ? match[1]! : null;
}

const routeScreen = (): Screen => (window.location.hash === "#/miniaturas" ? "history" : "editor");

async function exportBlob(scene: Scene): Promise<Blob> {
  const canvas = await scene.exportCanvas();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("export failed"))), "image/png"),
  );
}

async function previewBlob(scene: Scene): Promise<Blob> {
  const full = await scene.exportCanvas();
  const small = document.createElement("canvas");
  small.width = PREVIEW_WIDTH;
  small.height = Math.round((PREVIEW_WIDTH * CANVAS_HEIGHT) / CANVAS_WIDTH);
  const context = small.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  context.drawImage(full, 0, 0, small.width, small.height);
  return new Promise((resolve, reject) =>
    small.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("preview failed"))), "image/jpeg", 0.82),
  );
}

/** On iOS the share sheet is the way to save an image; elsewhere, a download.
 *  Resolves false when the person closed the share sheet without saving. */
async function download(blob: Blob): Promise<boolean> {
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
  const saver = new Saver(store);
  const library: LibraryState = { photos: [], config: null, busy: null };
  let view: View = STEPS[0]!.id;
  let screen: Screen = routeScreen();
  let recent: ThumbnailSummary[] | null = null;
  let recentError: string | null = null;

  // The canvas is a picture: it is named, and described in words that follow
  // every change.
  const description = h("p", { id: "stage-description", class: "visually-hidden" });
  const stageBox = h("div", { class: "stage", role: "img", "aria-label": "Miniatura", "aria-describedby": "stage-description" });
  const progress = h("ol", { class: "steps", "aria-label": "Pasos" });
  const panel = h("main", { class: "panel", id: "panel", tabindex: "-1" });

  // Saving is shown, never asked for: a word in the corner when all is well,
  // and a message that stays when something needs the host.
  const saveState = h("p", { class: "save-state" });
  const alertBox = h("div", { class: "sync-alert", role: "alert" });
  const historyButton = h("button", { type: "button", class: "top-link" });
  const topRow = h("div", { class: "top-row" }, historyButton, saveState);

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
  const stageWrap = h("section", { class: "stage-wrap", "aria-label": "Vista previa" }, stageBox, description);
  const header = h("header", { class: "top" }, topRow, progress);

  clear(root);
  root.append(header, alertBox, stageWrap, panel, nav);
  // The bar grows with larger text; the page keeps room for it.
  new ResizeObserver(() => {
    const html = document.documentElement;
    html.classList.toggle("large-text", parseFloat(getComputedStyle(html).fontSize) >= 24);
    html.style.setProperty("--tabs-h", `${nav.offsetHeight}px`);
  }).observe(nav);

  // A preview render rebuilds the scene; never in the middle of a gesture.
  let touching = 0;
  stageBox.addEventListener("pointerdown", () => (touching += 1));
  const release = () => (touching = Math.max(0, touching - 1));
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);

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
    saveView(store.id, to);
    // A step change is a natural pause: save now rather than in a moment.
    void saver.flush();
    render();
    // Say where we are: focus the step's question, at the top of the panel.
    panel.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }

  // --- Pictures for the history -------------------------------------------

  let previewTimer: number | undefined;
  let previewed = { id: "", version: 0 };
  async function sendPreview(): Promise<void> {
    window.clearTimeout(previewTimer);
    const version = store.version;
    const id = store.id;
    if (version === null || store.dirty() || (previewed.id === id && previewed.version === version)) return;
    if (touching > 0) {
      previewTimer = window.setTimeout(() => void sendPreview(), PREVIEW_DELAY_MS);
      return;
    }
    try {
      const blob = await previewBlob(scene);
      if (store.id !== id || store.version !== version) return;
      await putPicture(id, "preview", version, blob);
      previewed = { id, version };
    } catch (error) {
      // A preview is a convenience: the history shows the title without it.
      if (!(error instanceof Offline)) console.error("preview not stored", error);
    }
  }

  /** The download waits here until the version it shows is on the server. */
  let pendingExport: { id: string; doc: DesignDocument; blob: Blob } | null = null;
  async function sendExport(): Promise<void> {
    const pending = pendingExport;
    if (!pending || store.id !== pending.id || store.doc !== pending.doc || store.version === null || store.dirty()) return;
    try {
      await putPicture(pending.id, "export", store.version, pending.blob);
      if (pendingExport === pending) pendingExport = null;
      previewed = { id: pending.id, version: store.version };
    } catch (error) {
      if (!(error instanceof Offline)) console.error("download not stored", error);
    }
  }

  /** Opened from this device's copy while the server was away: the undo
   *  history comes from the server once it answers again. */
  let historyMissing = false;
  async function recoverHistory(): Promise<void> {
    historyMissing = false;
    const id = store.id;
    try {
      const server = await getThumbnail(id);
      if (!server || store.id !== id || !saver.settled() || server.version !== store.head) return;
      const opened = fromServer(server);
      if (opened) store.open(opened);
    } catch {
      historyMissing = true;
    }
  }

  saver.onSaved(() => {
    if (historyMissing) void recoverHistory();
    if (pendingExport) void sendExport();
    else {
      window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(() => void sendPreview(), PREVIEW_DELAY_MS);
    }
  });

  let downloading = false;
  async function finish(): Promise<void> {
    if (downloading) return;
    downloading = true;
    next.setAttribute("aria-disabled", "true");
    announce("Preparando la imagen…");
    try {
      const doc = store.doc;
      const blob = await exportBlob(scene);
      if (await download(blob)) {
        pendingExport = { id: store.id, doc, blob };
        go("done");
        await saver.flush();
        await sendExport();
      }
    } catch (error) {
      console.error(error);
      toast("No se pudo crear la imagen. Vuelve a intentarlo.", { error: true });
    } finally {
      downloading = false;
      next.removeAttribute("aria-disabled");
    }
  }

  // --- Opening, starting and leaving thumbnails ----------------------------

  /** Before another thumbnail is opened, this one must be on the server. */
  async function readyToLeave(): Promise<boolean> {
    if (saver.status.kind === "conflict") {
      toast("Antes, elige qué versión de esta miniatura quieres guardar (arriba).", { error: true });
      return false;
    }
    await saver.flush();
    if (saver.blocked() || !saver.settled()) {
      toast("Esta miniatura todavía no se pudo guardar. Espera a que vuelva la conexión.", { error: true });
      return false;
    }
    return true;
  }

  /** `push` adds a step to the browser's history (opening from the list,
   *  starting a new one), so «atrás» goes back to where the host was. */
  function show(start: Start, firstView: View, mode: "push" | "replace" = "replace"): void {
    window.clearTimeout(previewTimer);
    store.open(start.opened);
    saver.reset(start.status);
    view = firstView;
    saveView(store.id, view);
    const hash = `#/m/${store.id}`;
    if (window.location.hash !== hash) window.history[mode === "push" ? "pushState" : "replaceState"](null, "", hash);
    screen = "editor";
    render();
  }

  /** The first step not done yet, or «done» if it was downloaded as it is. */
  function viewFor(summary: Pick<ThumbnailState, "downloaded"> | null, id: string): View {
    const saved = loadView(id);
    if (saved) return saved;
    if (summary?.downloaded) return "done";
    return STEPS[0]!.id;
  }

  async function openById(id: string, mode: "push" | "replace" = "replace"): Promise<boolean> {
    let server: ThumbnailState | null | "offline";
    try {
      server = await getThumbnail(id);
    } catch (error) {
      if (!(error instanceof Offline)) throw error;
      server = "offline";
    }
    const start = reconcile(id, server, readLocal(storage()));
    if (!start) return false;
    show(start, viewFor(server === "offline" ? null : server, id), mode);
    historyMissing = server === "offline";
    return true;
  }

  function begin(doc: DesignDocument, mode: "push" | "replace" = "replace"): void {
    const id = newThumbnailId();
    show({ opened: { id, head: 0, current: { doc, version: null }, history: [] }, status: { kind: "saving" } }, STEPS[0]!.id, mode);
    // A new thumbnail is on the server at once, so another device sees it.
    void saver.flush();
  }

  async function startNew(): Promise<void> {
    if (!(await readyToLeave())) return;
    begin(startOfDay(store.doc, library.photos), "push");
    panel.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    toast("Miniatura nueva. La anterior quedó en «Mis miniaturas».");
  }

  async function openFromHistory(id: string): Promise<void> {
    if (id === store.id) {
      backToEditor();
      return;
    }
    if (!(await readyToLeave())) return;
    if (await openById(id, "push")) {
      panel.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    } else toast("No se pudo abrir esa miniatura. Revisa la conexión.", { error: true });
  }

  async function duplicate(): Promise<void> {
    if (!(await readyToLeave())) return;
    try {
      const id = await duplicateThumbnail(store.id);
      if (await openById(id, "push")) {
        go(STEPS[STEPS.length - 1]!.id);
        toast("Copia hecha. Cambia el título o lo que quieras; la otra no se toca.");
      }
    } catch {
      toast("No se pudo hacer la copia. Revisa la conexión.", { error: true });
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm("¿Borrar esta miniatura de «Mis miniaturas»? La imagen que ya descargaste no se borra.")) return;
    try {
      await deleteThumbnail(store.id);
    } catch {
      toast("No se pudo borrar. Revisa la conexión.", { error: true });
      return;
    }
    toast("Miniatura borrada.");
    begin(startOfDay(store.doc, library.photos), "push");
  }

  function backToEditor(): void {
    window.history.pushState(null, "", `#/m/${store.id}`);
    screen = "editor";
    render();
    panel.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }

  async function showHistory(): Promise<void> {
    if (routeScreen() !== "history") window.history.pushState(null, "", "#/miniaturas");
    screen = "history";
    recent = null;
    recentError = null;
    render();
    panel.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    // The list should show the thumbnail as it is now.
    await saver.flush();
    await sendPreview();
    await loadRecent();
  }

  async function loadRecent(): Promise<void> {
    try {
      recent = await listThumbnails();
      recentError = null;
    } catch {
      recent = null;
      recentError = "No se pudo cargar la lista: no hay conexión con el servidor.";
    }
    if (screen === "history") render();
  }

  window.addEventListener("popstate", () => {
    const wanted = routeScreen();
    if (wanted === "history") {
      if (screen !== "history") void showHistory();
      return;
    }
    const id = routeId();
    screen = "editor";
    if (id && id !== store.id) {
      void readyToLeave().then(async (ok) => {
        if (ok && !(await openById(id))) toast("No se pudo abrir esa miniatura.", { error: true });
        else render();
      });
    } else render();
  });

  // --- Saving, shown --------------------------------------------------------

  function renderSync(status: SyncStatus): void {
    saveState.className = `save-state ${status.kind}`;
    saveState.textContent =
      status.kind === "saved"
        ? "✓ Guardado"
        : status.kind === "saving"
          ? "Guardando…"
          : status.kind === "offline"
            ? "Sin conexión"
            : status.kind === "conflict"
              ? "Sin guardar"
              : "Borrada";
    const button = (label: string, action: () => void, primary = false) =>
      h("button", { type: "button", class: `button${primary ? " primary" : ""}`, on: { click: action } }, label);
    let content: HTMLElement | null = null;
    if (status.kind === "offline") {
      content = h(
        "div",
        { class: "sync-message" },
        h("p", {}, h("strong", {}, "No hay conexión con el servidor. "), "Lo que haces queda guardado en este teléfono y se sube solo cuando vuelva."),
        h("div", { class: "sync-actions" }, button("Volver a intentar ahora", () => saver.retry())),
      );
    } else if (status.kind === "conflict") {
      content = h(
        "div",
        { class: "sync-message" },
        h("p", {}, h("strong", {}, "Esta miniatura cambió en otro teléfono o pestaña. "), "Lo de esta pantalla no se guardó, para no borrar lo otro."),
        h(
          "div",
          { class: "sync-actions" },
          button("Ver la versión más nueva", () => void loadNewest(), true),
          button("Guardar la de esta pantalla", () => void saver.overwrite(status.version)),
        ),
      );
    } else if (status.kind === "gone") {
      content = h(
        "div",
        { class: "sync-message" },
        h("p", {}, h("strong", {}, "Esta miniatura se borró en otro teléfono o pestaña.")),
        h("div", { class: "sync-actions" }, button("Guardarla como una nueva", () => begin(store.doc), true)),
      );
    }
    alertBox.replaceChildren(...(content ? [content] : []));
    alertBox.hidden = !content;
  }

  async function loadNewest(): Promise<void> {
    try {
      const server = await getThumbnail(store.id);
      const start = server ? reconcile(store.id, server, null) : null;
      if (!start) throw new Error("not found");
      show(start, view);
      toast("Se cargó la versión más nueva.");
    } catch {
      toast("No se pudo cargar la versión más nueva. Revisa la conexión.", { error: true });
    }
  }

  /** When the page comes back into view: another device may have saved this
   *  thumbnail meanwhile. With nothing unsaved here, its version is simply
   *  shown; with something unsaved, the next save reports the conflict. */
  async function checkNewer(): Promise<void> {
    if (!store.id || !saver.settled() || saver.status.kind !== "saved") return;
    try {
      const server = await getThumbnail(store.id);
      if (!server) {
        if (saver.settled()) saver.reset({ kind: "gone" });
        return;
      }
      if (server.version > store.head && saver.settled()) {
        const start = reconcile(store.id, server, null);
        if (start) {
          show(start, view);
          toast("Se cargó la versión más nueva: cambió en otro teléfono o pestaña.");
        }
      }
    } catch {
      // Offline: the next save will say so.
    }
  }

  // The alert region announces itself when a message appears.
  saver.onStatus(renderSync);
  window.addEventListener("online", () => saver.retry());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void saver.flush({ keepalive: true });
    else {
      saver.retry();
      void checkNewer();
    }
  });
  window.addEventListener("pagehide", () => void saver.flush({ keepalive: true }));

  // --- Rendering ------------------------------------------------------------

  function renderTop(): void {
    const inHistory = screen === "history";
    historyButton.replaceChildren(
      inHistory
        ? h("span", {}, h("span", { "aria-hidden": "true" }, "← "), "Volver a la miniatura")
        : h("span", {}, "Mis miniaturas"),
    );
    historyButton.onclick = inHistory ? backToEditor : () => void showHistory();
    progress.hidden = inHistory;
    stageWrap.hidden = inHistory;
    nav.hidden = inHistory;
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
      next.onclick = () => void startNew();
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
      if (screen === "history") {
        panel.replaceChildren(
          historyPanel({
            thumbnails: recent,
            currentId: store.id,
            error: recentError,
            open: (id) => void openFromHistory(id),
            startNew: () => void startNew(),
            retry: () => void loadRecent(),
          }),
        );
        return;
      }
      if (view === "done") {
        panel.replaceChildren(
          h(
            "div",
            { class: "panel-body" },
            h("h1", { tabindex: "-1" }, "✓ Miniatura lista"),
            h(
              "p",
              {},
              "Quedó en tu teléfono y en «Mis miniaturas». Para mañana, toca «Hacer una nueva»: el marco y el conductor ya van puestos.",
            ),
            h("div", { class: "row" }, h("button", { type: "button", class: "button", on: { click: () => void finish() } }, "Descargar otra vez")),
            advanced(
              "thumbnail",
              h("h2", {}, "Esta miniatura"),
              h("p", { class: "muted" }, "Una copia empieza igual que esta; lo que cambies en la copia no toca a esta."),
              h("div", { class: "row" }, h("button", { type: "button", class: "button", on: { click: () => void duplicate() } }, "Hacer otra como esta")),
              h(
                "div",
                { class: "row" },
                h("button", { type: "button", class: "button danger", on: { click: () => void remove() } }, "Borrar esta miniatura"),
              ),
            ),
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
    renderTop();
    if (screen === "editor") {
      renderProgress();
      renderBar();
    }
    renderPanel();
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
    saver.changed();
    scene.setDocument(store.doc);
    scene.setSelection(store.selection);
    describe();
    if (screen !== "editor") return;
    if (quiet) {
      undo.setAttribute("aria-disabled", String(!store.canUndo()));
      renderProgress();
    } else render();
  });

  renderSync(saver.status);
  await refreshLibrary();

  // Which thumbnail to open: the one in the address, else the one this device
  // had open, else the newest one saved (from another device, say), else a
  // new one, which starts from the old single draft if this device has it.
  const local = readLocal(storage());
  const wanted = routeId() ?? local?.id ?? null;
  let opened = wanted ? await openById(wanted) : false;
  if (!opened) {
    try {
      const newest = (await listThumbnails())[0];
      if (newest) opened = await openById(newest.id);
    } catch {
      // Offline with nothing kept here: a new thumbnail, saved when it can be.
    }
  }
  if (!opened) {
    const legacy = takeLegacyDraft();
    if (legacy) {
      // That draft's host was a «person»; people became guests on the server,
      // and the one in the host slot is the host.
      for (const host of people(legacy, "host")) {
        const photo = library.photos.find((p) => p.id === host.photo.photoId);
        if (photo?.role === "guest") await setRole(photo.id, "host").catch(() => undefined);
      }
      await refreshLibrary();
    }
    begin(legacy ?? startOfDay(null, library.photos));
    if (legacy) forgetLegacyDraft();
  }
  if (screen === "history") void showHistory();

  // The seam for a headless render (ADR 0005): load a document and export it
  // from this same scene.
  (window as unknown as { studio: unknown }).studio = {
    document: (): DesignDocument => store.doc,
    thumbnail: () => ({ id: store.id, head: store.head, version: store.version, status: saver.status }),
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
