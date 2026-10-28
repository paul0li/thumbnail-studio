// The Konva scene, built from the design document. Gestures never keep state in
// Konva: when a drag, a handle or a pinch ends, the new placement is written to
// the document, and the scene is rebuilt from it.

import Konva from "konva";
import { clampScale, placeLayer } from "../document/edit";
import { layoutTitle, type Metrics, type TitleLayout } from "../document/layout";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  type BackgroundLayer,
  type DesignDocument,
  type FrameLayer,
  type LogoLayer,
  type PersonLayer,
  type TitleLayer,
} from "../document/types";
import { drawCover, drawPhoto, drawWord } from "./draw";
import { imageFor, loadImages } from "./images";

export type Selection = { layerId: string; word: number | null } | null;

export interface SceneEvents {
  select(selection: Selection): void;
  change(doc: DesignDocument): void;
}

type Native = CanvasRenderingContext2D;
const native = (context: Konva.Context): Native => context._context;

const TONES: Record<BackgroundLayer["tone"], [string, string]> = {
  dark: ["#2a2d36", "#08090c"],
  light: ["#eef0f5", "#bcc2d0"],
};

Konva.hitOnDragEnabled = true;

export class Scene {
  private readonly stage: Konva.Stage;
  private readonly main = new Konva.Layer();
  private readonly ui = new Konva.Layer();
  private readonly transformer: Konva.Transformer;
  private readonly wordMark = new Konva.Rect({
    stroke: "#ffffff",
    strokeWidth: 3,
    dash: [10, 6],
    shadowColor: "#000",
    shadowBlur: 4,
    listening: false,
    visible: false,
  });
  private doc: DesignDocument | null = null;
  private selection: Selection = null;
  private titleLayout: TitleLayout | null = null;
  private renderQueued = false;
  private pinch: { distance: number; scale: number; centre: { x: number; y: number } } | null = null;

  constructor(
    container: HTMLDivElement,
    private readonly metrics: Metrics,
    private readonly events: SceneEvents,
  ) {
    this.stage = new Konva.Stage({ container, width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
    this.transformer = new Konva.Transformer({
      rotateEnabled: false,
      flipEnabled: false,
      keepRatio: true,
      enabledAnchors: ["top-left", "top-right", "bottom-left", "bottom-right"],
      anchorSize: 26,
      anchorCornerRadius: 13,
      anchorStroke: "#ffffff",
      anchorFill: "#111214",
      borderStroke: "#ffffff",
      borderStrokeWidth: 2,
      padding: 4,
      ignoreStroke: true,
      boundBoxFunc: (old, next) => (Math.abs(next.width) < 30 || Math.abs(next.height) < 30 ? old : next),
    });
    this.transformer.on("transformend", () => this.commitNode(this.transformer.nodes()[0]));
    this.ui.add(this.transformer, this.wordMark);
    this.stage.add(this.main, this.ui);
    this.stage.on("touchmove", (e) => this.onTouchMove(e.evt));
    this.stage.on("touchend touchcancel", () => this.endPinch());
  }

  /** Fits the stage to a width in CSS pixels; the scene stays 1280x720 inside. */
  resize(width: number): void {
    const scale = width / CANVAS_WIDTH;
    this.stage.size({ width, height: (CANVAS_HEIGHT * width) / CANVAS_WIDTH });
    this.stage.scale({ x: scale, y: scale });
    this.transformer.anchorSize(Math.max(18, Math.min(30, 26 / Math.max(scale * 2.5, 1))));
    this.stage.batchDraw();
  }

  setDocument(doc: DesignDocument): void {
    // The same document means nothing to redraw, and redrawing would drop the
    // node a finger has just landed on.
    if (doc === this.doc) return;
    this.doc = doc;
    this.render();
  }

  setSelection(selection: Selection): void {
    this.selection = selection;
    this.updateSelection();
  }

  private requestRender = (): void => {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      // Rebuilding mid-gesture would drop the node under the finger.
      if (this.stage.isDragging() || this.transformer.isTransforming() || this.pinch) {
        this.requestRender();
        return;
      }
      this.render();
    });
  };

  render(): void {
    const doc = this.doc;
    if (!doc) return;
    this.main.destroyChildren();
    this.titleLayout = null;
    for (const layer of doc.layers) {
      switch (layer.kind) {
        case "background":
          this.main.add(this.background(layer));
          break;
        case "person":
        case "logo":
          this.main.add(this.photo(layer));
          break;
        case "title":
          this.main.add(this.title(layer));
          break;
        case "frame":
          this.main.add(this.frame(layer));
          break;
      }
    }
    this.updateSelection();
    this.main.batchDraw();
  }

  private background(layer: BackgroundLayer): Konva.Shape {
    const shape = new Konva.Shape({
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      sceneFunc: (context) => {
        const ctx = native(context);
        const image = layer.photo ? imageFor(layer.photo.src, this.requestRender) : null;
        if (image) {
          drawCover(ctx, image, CANVAS_WIDTH, CANVAS_HEIGHT, layer.flipX);
          return;
        }
        const [from, to] = TONES[layer.tone];
        const gradient = ctx.createRadialGradient(640, 300, 80, 640, 360, 820);
        gradient.addColorStop(0, from);
        gradient.addColorStop(1, to);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      },
      hitFunc: (context, shape) => {
        context.beginPath();
        context.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        context.fillStrokeShape(shape);
      },
    });
    shape.on("mousedown touchstart", () => this.select(null));
    return shape;
  }

  private frame(layer: FrameLayer): Konva.Shape {
    return new Konva.Shape({
      listening: false,
      sceneFunc: (context) => {
        const image = imageFor(layer.photo.src, this.requestRender);
        if (image) native(context).drawImage(image, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      },
    });
  }

  private photo(layer: PersonLayer | LogoLayer): Konva.Group {
    const { width, height } = layer.photo;
    const flipX = layer.kind === "person" && layer.flipX;
    const group = new Konva.Group({
      id: layer.id,
      x: layer.x,
      y: layer.y,
      scaleX: layer.scale,
      scaleY: layer.scale,
      draggable: true,
    });
    const shape = new Konva.Shape({
      width,
      height,
      offsetX: width / 2,
      offsetY: height / 2,
      sceneFunc: (context) => {
        const ctx = native(context);
        ctx.save();
        ctx.translate(width / 2, height / 2);
        const image = imageFor(layer.photo.src, this.requestRender);
        if (image) {
          // Effects are in canvas pixels; the photo is drawn in its own pixels.
          drawPhoto(ctx, image, width, height, flipX, layer.effects, 1 / layer.scale);
        } else {
          ctx.fillStyle = "rgba(255,255,255,0.15)";
          ctx.fillRect(-width / 2, -height / 2, width, height);
        }
        ctx.restore();
      },
      hitFunc: (context, s) => {
        context.beginPath();
        context.rect(0, 0, width, height);
        context.fillStrokeShape(s);
      },
    });
    group.add(shape);
    group.on("mousedown touchstart", () => this.select({ layerId: layer.id, word: null }));
    group.on("dragmove", () => {
      group.x(Math.min(CANVAS_WIDTH, Math.max(0, group.x())));
      group.y(Math.min(CANVAS_HEIGHT, Math.max(0, group.y())));
    });
    group.on("dragend", () => this.commitNode(group));
    return group;
  }

  private title(layer: TitleLayer): Konva.Group {
    const layout = layoutTitle(layer.words, layer.align, this.metrics);
    this.titleLayout = layout;
    const group = new Konva.Group({
      id: layer.id,
      x: layer.x,
      y: layer.y,
      scaleX: layer.scale,
      scaleY: layer.scale,
      draggable: true,
    });
    for (const line of layout.lines) {
      for (const word of line.words) {
        const data = layer.words[word.index]!;
        const b = word.bounds;
        const shape = new Konva.Shape({
          name: `word-${word.index}`,
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          sceneFunc: (context) => {
            const ctx = native(context);
            ctx.save();
            ctx.translate(-b.x, -b.y);
            drawWord(ctx, data, word, layer.effects, this.metrics);
            ctx.restore();
          },
          hitFunc: (context, s) => {
            const pad = 8;
            context.beginPath();
            context.rect(-pad, -pad, b.width + 2 * pad, b.height + 2 * pad);
            context.fillStrokeShape(s);
          },
        });
        shape.on("click tap", () => this.select({ layerId: layer.id, word: word.index }));
        group.add(shape);
      }
    }
    group.on("mousedown touchstart", () => {
      if (this.selection?.layerId !== layer.id) this.select({ layerId: layer.id, word: null });
    });
    group.on("dragmove", () => {
      // Free, as long as the centre of the block stays on the canvas.
      const s = group.scaleX();
      const cx = group.x() + (layout.width * s) / 2;
      const cy = group.y() + (layout.height * s) / 2;
      group.x(group.x() + Math.min(CANVAS_WIDTH, Math.max(0, cx)) - cx);
      group.y(group.y() + Math.min(CANVAS_HEIGHT, Math.max(0, cy)) - cy);
    });
    group.on("dragend", () => this.commitNode(group));
    return group;
  }

  private select(selection: Selection): void {
    this.selection = selection;
    this.updateSelection();
    this.events.select(selection);
  }

  private updateSelection(): void {
    const id = this.selection?.layerId;
    const node = id ? this.main.findOne<Konva.Group>(`#${id}`) : undefined;
    this.transformer.nodes(node ? [node] : []);
    const word = this.selection?.word;
    const wordNode = node && word !== null && word !== undefined ? node.findOne(`.word-${word}`) : undefined;
    if (wordNode) {
      const r = wordNode.getClientRect({ relativeTo: this.stage });
      this.wordMark.setAttrs({ x: r.x - 6, y: r.y - 6, width: r.width + 12, height: r.height + 12, visible: true });
    } else {
      this.wordMark.visible(false);
    }
    this.ui.batchDraw();
  }

  /** Writes a node's placement back to the document. */
  private commitNode(node: Konva.Node | undefined): void {
    if (!node || !this.doc) return;
    const next = placeLayer(this.doc, node.id(), node.x(), node.y(), node.scaleX());
    this.doc = next;
    this.events.change(next);
    this.render();
  }

  private onTouchMove(evt: TouchEvent): void {
    const t1 = evt.touches[0];
    const t2 = evt.touches[1];
    const node = this.transformer.nodes()[0];
    if (!t1 || !t2 || !node || !this.doc) return;
    evt.preventDefault();
    if (node.isDragging()) node.stopDrag();
    const distance = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    const layer = this.doc.layers.find((l) => l.id === node.id());
    if (!layer || (layer.kind !== "person" && layer.kind !== "logo" && layer.kind !== "title")) return;
    if (!this.pinch) {
      const box = node.getClientRect({ relativeTo: this.stage });
      this.pinch = { distance, scale: node.scaleX(), centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
      return;
    }
    const scale = clampScale(layer, (this.pinch.scale * distance) / this.pinch.distance);
    if (layer.kind === "title" && this.titleLayout) {
      // The title's origin is its top-left corner: keep its centre still.
      node.x(this.pinch.centre.x - (this.titleLayout.width * scale) / 2);
      node.y(this.pinch.centre.y - (this.titleLayout.height * scale) / 2);
    }
    node.scale({ x: scale, y: scale });
    this.transformer.forceUpdate();
    this.main.batchDraw();
    this.ui.batchDraw();
  }

  private endPinch(): void {
    if (!this.pinch) return;
    this.pinch = null;
    this.commitNode(this.transformer.nodes()[0]);
  }

  /** The thumbnail at exactly 1280x720, from this same scene, without handles. */
  async exportCanvas(): Promise<HTMLCanvasElement> {
    const doc = this.doc;
    if (!doc) throw new Error("no document");
    const srcs = doc.layers.flatMap((l) => (l.kind !== "title" && l.photo ? [l.photo.src] : []));
    await loadImages(srcs);
    this.render();
    this.ui.visible(false);
    try {
      const pixelRatio = CANVAS_WIDTH / this.stage.width();
      const rendered = this.stage.toCanvas({ pixelRatio });
      const out = document.createElement("canvas");
      out.width = CANVAS_WIDTH;
      out.height = CANVAS_HEIGHT;
      out.getContext("2d")!.drawImage(rendered, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      return out;
    } finally {
      this.ui.visible(true);
      this.ui.batchDraw();
    }
  }
}
