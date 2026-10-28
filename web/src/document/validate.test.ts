import { describe, expect, it } from "vitest";
import { addPerson, newDocument, setFrame, updateTitle } from "./edit";
import { applyPreset } from "./presets";
import type { DesignDocument, PhotoRef } from "./types";
import { validateDocument } from "./validate";

const photo: PhotoRef = { photoId: "p1", src: "/api/files/aa/x.png", width: 400, height: 800 };

function errors(doc: unknown): string[] {
  const result = validateDocument(doc);
  return result.ok ? [] : result.errors;
}

function clone(doc: DesignDocument): DesignDocument {
  return JSON.parse(JSON.stringify(doc)) as DesignDocument;
}

describe("validateDocument", () => {
  it("accepts a new document and one with every kind of layer", () => {
    expect(errors(newDocument())).toEqual([]);
    let doc = addPerson(newDocument(), photo);
    doc = setFrame(doc, photo);
    doc = updateTitle(doc, (t) => applyPreset(t, "neon"));
    expect(errors(doc)).toEqual([]);
  });

  it("survives a round trip through JSON", () => {
    const doc = addPerson(newDocument("HOLA MUNDO"), photo);
    expect(errors(clone(doc))).toEqual([]);
  });

  it("rejects a title whose words are not what was typed", () => {
    const doc = clone(newDocument("NADIE LO VIO"));
    const t = doc.layers.find((l) => l.kind === "title")!;
    if (t.kind !== "title") throw new Error();
    t.words[1]!.text = "LA";
    expect(errors(doc)).toContain("layers[1].words: must be exactly the words of the typed title, in order");
  });

  it("rejects a title with a word missing or added", () => {
    const doc = clone(newDocument("NADIE LO VIO"));
    const t = doc.layers[1]!;
    if (t.kind !== "title") throw new Error();
    t.words.pop();
    expect(errors(doc).some((e) => e.includes("exactly the words"))).toBe(true);
  });

  it("compares words ignoring case and extra whitespace", () => {
    const doc = clone(newDocument("NADIE LO VIO"));
    const t = doc.layers[1]!;
    if (t.kind !== "title") throw new Error();
    t.text = "  nadie   lo\nvio ";
    expect(errors(doc)).toEqual([]);
  });

  it("rejects a word with a space inside", () => {
    const doc = clone(newDocument("NADIE LO"));
    const t = doc.layers[1]!;
    if (t.kind !== "title") throw new Error();
    t.text = "NADIE LO";
    t.words = [{ ...t.words[0]!, text: "NADIE LO" }];
    expect(errors(doc)).toContain("layers[1].words[0].text: must be one word, without spaces");
  });

  it("rejects an effect a layer cannot have", () => {
    const doc = clone(newDocument());
    const t = doc.layers[1]!;
    if (t.kind !== "title") throw new Error();
    t.effects = [{ type: "halo", color: "#ffffff", opacity: 1, size: 1 }];
    expect(errors(doc)).toContain("layers[1].effects[0].type: is not an effect a title can have");
  });

  it("rejects bad colours and numbers", () => {
    const doc = clone(newDocument());
    const t = doc.layers[1]!;
    if (t.kind !== "title") throw new Error();
    t.effects = [{ type: "outline", color: "red", width: Number.NaN }];
    expect(errors(doc)).toEqual([
      "layers[1].effects[0].color: must be a #rrggbb colour",
      "layers[1].effects[0].width: must be a number",
    ]);
  });

  it("keeps the background first and the frame last", () => {
    const doc = clone(setFrame(newDocument(), photo));
    doc.layers.reverse();
    const found = errors(doc);
    expect(found).toContain("layers[0]: the frame must be the last layer");
    expect(found).toContain("layers[2]: the background must be the first layer");
  });

  it("rejects the wrong size, version or a repeated id", () => {
    const doc = clone(addPerson(newDocument(), photo)) as unknown as Record<string, unknown>;
    doc.width = 1920;
    doc.version = 2;
    const layers = doc.layers as { id: string }[];
    layers[1]!.id = layers[0]!.id;
    const found = errors(doc);
    expect(found).toContain("size: must be 1280x720");
    expect(found).toContain("version: must be 1");
    expect(found).toContain("layers[1].id: is repeated");
  });

  it("rejects something that is not a document at all", () => {
    expect(errors(null)).toEqual(["document: must be an object"]);
    expect(errors({ version: 1, width: 1280, height: 720 })).toContain("layers: must be a list");
  });
});
