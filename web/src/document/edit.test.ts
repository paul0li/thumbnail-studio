import { describe, expect, it } from "vitest";
import { addPerson, canReorder, newDocument, placeLayer, reorder, replacePhoto, setFrame, setLogo } from "./edit";
import type { PhotoRef } from "./types";
import { validateDocument } from "./validate";

const photo: PhotoRef = { photoId: "p", src: "/x.png", width: 500, height: 1000 };

describe("document edits", () => {
  it("a new person is placed below the title and stands on the bottom edge", () => {
    const doc = addPerson(newDocument(), photo);
    expect(doc.layers.map((l) => l.kind)).toEqual(["background", "person", "title"]);
    const person = doc.layers[1]!;
    if (person.kind !== "person") throw new Error();
    expect(person.photo.height * person.scale).toBe(560);
    expect(person.y + (person.photo.height * person.scale) / 2).toBe(720);
  });

  it("the frame stays on top whatever is added after it", () => {
    let doc = setFrame(newDocument(), photo);
    doc = addPerson(doc, photo);
    doc = setLogo(doc, photo);
    expect(doc.layers[doc.layers.length - 1]!.kind).toBe("frame");
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("reordering moves between the background and the frame, never past them", () => {
    let doc = setFrame(addPerson(newDocument(), photo), photo);
    const person = doc.layers[1]!.id;
    expect(canReorder(doc, person, -1)).toBe(false);
    doc = reorder(doc, person, 1);
    expect(doc.layers.map((l) => l.kind)).toEqual(["background", "title", "person", "frame"]);
    expect(canReorder(doc, person, 1)).toBe(false);
  });

  it("moving is free but a photo's centre stays on the canvas", () => {
    let doc = addPerson(newDocument(), photo);
    const id = doc.layers[1]!.id;
    doc = placeLayer(doc, id, 5000, -40);
    const person = doc.layers[1]!;
    if (person.kind !== "person") throw new Error();
    expect([person.x, person.y]).toEqual([1280, 0]);
  });

  it("a logo replaces the previous one and keeps its place", () => {
    let doc = setLogo(newDocument(), photo);
    const first = doc.layers.find((l) => l.kind === "logo")!;
    doc = placeLayer(doc, first.id, 300, 200);
    doc = setLogo(doc, { ...photo, photoId: "other" });
    const logos = doc.layers.filter((l) => l.kind === "logo");
    expect(logos).toHaveLength(1);
    expect(logos[0]!.kind === "logo" && [logos[0]!.x, logos[0]!.y, logos[0]!.photo.photoId]).toEqual([300, 200, "other"]);
  });
});

describe("replacePhoto", () => {
  it("a cut-out photo replaces the original where it is used, at the same height", () => {
    const doc = addPerson(newDocument(), photo);
    const next = replacePhoto(doc, { ...photo, src: "/cut.png", width: 300, height: 600 });
    const person = next.layers[1]!;
    if (person.kind !== "person") throw new Error();
    expect(person.photo.src).toBe("/cut.png");
    expect(person.photo.height * person.scale).toBeCloseTo(560);
  });
});
