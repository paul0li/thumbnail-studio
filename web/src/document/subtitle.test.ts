import { describe, expect, it } from "vitest";
import { describeDocument } from "../ui/describe";
import { addPerson, newDocument, placeLayer, removeLayer, setSubtitle, subtitle, title, updateText } from "./edit";
import { engineScene, plainTitle } from "./improve";
import { layoutTitle } from "./layout";
import { applyPreset } from "./presets";
import { mono } from "./testing";
import { SUBTITLE_WORD_SIZE } from "./title";
import type { PhotoRef } from "./types";
import { validateDocument } from "./validate";

const photo: PhotoRef = { photoId: "p", src: "/x.png", width: 500, height: 1000 };

describe("the subtitle", () => {
  it("is not there until the host types one", () => {
    expect(subtitle(newDocument())).toBeUndefined();
    expect(setSubtitle(newDocument(), "  ", mono).layers.map((l) => l.kind)).toEqual(["background", "title"]);
  });

  it("starts just under the title, left aligned with it, smaller and without the accent bar", () => {
    const doc = setSubtitle(newDocument(), "CON UN INVITADO", mono);
    const t = title(doc)!;
    const s = subtitle(doc)!;
    expect(doc.layers.map((l) => l.kind)).toEqual(["background", "title", "subtitle"]);
    expect(s.words.map((w) => w.text)).toEqual(["CON", "UN", "INVITADO"]);
    expect(s.words.every((w) => w.size === SUBTITLE_WORD_SIZE)).toBe(true);
    expect(s.accent).toBeNull();
    expect(s.x).toBe(t.x);
    expect(s.y).toBeGreaterThan(t.y + layoutTitle(t.words, t.align, mono).height);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("keeps its place and style while retyped, and goes when cleared", () => {
    let doc = setSubtitle(newDocument(), "CON UN", mono);
    const id = subtitle(doc)!.id;
    doc = placeLayer(doc, id, 300, 400);
    doc = updateText(doc, "subtitle", (s) => applyPreset(s, "neon"));
    doc = setSubtitle(doc, "CON UN INVITADO", mono);
    const s = subtitle(doc)!;
    expect(s.id).toBe(id);
    expect([s.x, s.y, s.preset]).toEqual([300, 400, "neon"]);
    expect(s.words).toHaveLength(3);
    expect(subtitle(setSubtitle(doc, "", mono))).toBeUndefined();
  });

  it("stays above the photos added after it, and can be removed like a photo", () => {
    let doc = setSubtitle(newDocument(), "CON UN INVITADO", mono);
    doc = addPerson(doc, photo);
    expect(doc.layers.map((l) => l.kind)).toEqual(["background", "person", "title", "subtitle"]);
    expect(subtitle(removeLayer(doc, subtitle(doc)!.id))).toBeUndefined();
  });

  it("is sent to the image engine in its plain style, still smaller than the title", () => {
    let doc = setSubtitle(newDocument(), "CON UN INVITADO", mono);
    doc = updateText(doc, "subtitle", (s) => ({ ...applyPreset(s, "neon"), words: s.words.map((w) => ({ ...w, size: 120 })) }));
    const scene = engineScene(doc, mono);
    const s = scene.layers.find((l) => l.kind === "subtitle")!;
    expect(s.kind === "subtitle" && s.words.every((w) => w.size === SUBTITLE_WORD_SIZE)).toBe(true);
    expect(s.kind === "subtitle" && s.accent).toBeNull();
    expect(plainTitle(title(doc)!, mono).accent).not.toBeNull();
  });

  it("is said in the canvas description", () => {
    const doc = setSubtitle(newDocument(), "CON UN INVITADO", mono);
    expect(describeDocument(doc)).toContain("Subtítulo: «CON UN INVITADO».");
  });
});
