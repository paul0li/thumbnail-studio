import { describe, expect, it } from "vitest";
import { engineScene, overlayLayers, plainTitle } from "./improve";
import { addPerson, newDocument, setFrame, setLogo, title, updateTitle } from "./edit";
import { applyPreset } from "./presets";
import { retitle } from "./title";
import { mono } from "./testing";
import type { PhotoRef } from "./types";

const photo = (id: string): PhotoRef => ({ photoId: id, src: `/api/files/aa/${id}.png`, width: 500, height: 1000 });

function styled() {
  let doc = newDocument();
  doc = addPerson(doc, photo("guest"));
  doc = setLogo(doc, photo("logo"));
  doc = setFrame(doc, photo("frame"));
  doc = updateTitle(doc, (t) => retitle(t, "NADIE LO VIO VENIR", mono));
  doc = updateTitle(doc, (t) => applyPreset(t, "neon"));
  doc = updateTitle(doc, (t) => ({
    ...t,
    x: 120,
    scale: 1.2,
    autoBreaks: false,
    words: t.words.map((w, i) => ({ ...w, size: i === 0 ? 200 : 60, breakBefore: i === 2, box: i === 1 ? { color: "#E92827" } : null })),
  }));
  return doc;
}

describe("what «Mejorar» sends", () => {
  it("the scene has no frame and no logo; the overlay has only them", () => {
    const doc = styled();
    expect(engineScene(doc, mono).layers.map((l) => l.kind)).toEqual(["background", "person", "title"]);
    expect(overlayLayers(doc).map((l) => l.kind)).toEqual(["logo", "frame"]);
  });

  it("the title goes in the plain brand style, every word alike, same words and place", () => {
    const doc = styled();
    const sent = title(engineScene(doc, mono))!;
    expect(sent.words.map((w) => w.text)).toEqual(["NADIE", "LO", "VIO", "VENIR"]);
    expect(new Set(sent.words.map((w) => w.size)).size).toBe(1);
    expect(sent.words.every((w) => w.box === null && w.fill.type === "solid")).toBe(true);
    expect(sent.preset).toBe("brand");
    expect(sent.accent).not.toBeNull();
    expect(sent.x).toBe(120);
    expect(sent.scale).toBe(1.2);
    // The host's document is not touched.
    expect(title(doc)!.preset).toBe("neon");
  });

  it("long titles are wrapped as the routine wraps them", () => {
    const long = plainTitle(retitle(title(newDocument())!, "UNA DOS TRES CUATRO CINCO SEIS SIETE OCHO NUEVE DIEZ", mono), mono);
    expect(long.words.some((w) => w.breakBefore)).toBe(true);
  });
});
