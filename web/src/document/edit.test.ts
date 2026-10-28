import { describe, expect, it } from "vitest";
import {
  addPerson,
  GUEST_HEIGHT,
  HOST_HEIGHT,
  people,
  setHost,
  toggleGuest,
  canReorder,
  newDocument,
  placeLayer,
  reorder,
  replacePhoto,
  SCALE_STEP,
  scaleLayerStep,
  setFrame,
  setLogo,
} from "./edit";
import type { PhotoRef } from "./types";
import { validateDocument } from "./validate";

const photo: PhotoRef = { photoId: "p", src: "/x.png", width: 500, height: 1000 };

describe("document edits", () => {
  it("a new person is placed below the title and stands on the bottom edge", () => {
    const doc = addPerson(newDocument(), photo);
    expect(doc.layers.map((l) => l.kind)).toEqual(["background", "person", "title"]);
    const person = doc.layers[1]!;
    if (person.kind !== "person") throw new Error();
    expect(person.photo.height * person.scale).toBe(GUEST_HEIGHT);
    expect(person.y + (person.photo.height * person.scale) / 2).toBe(720);
  });

  it("the host goes flush right and behind the guests; guests line up from the left", () => {
    let doc = addPerson(newDocument(), photo, "guest");
    doc = addPerson(doc, photo, "guest");
    doc = setHost(doc, { ...photo, photoId: "host" });
    const [host] = people(doc, "host");
    const guests = people(doc, "guest");
    expect(host!.x + (host!.photo.width * host!.scale) / 2).toBe(1280);
    expect(host!.photo.height * host!.scale).toBe(HOST_HEIGHT);
    expect(doc.layers.indexOf(host!)).toBeLessThan(doc.layers.indexOf(guests[0]!));
    const w = (g: (typeof guests)[number]) => g.photo.width * g.scale;
    expect(guests[0]!.x - w(guests[0]!) / 2).toBe(20);
    expect(guests[1]!.x).toBeGreaterThan(guests[0]!.x);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("choosing another host replaces the first; tapping a guest again takes them out", () => {
    let doc = setHost(newDocument(), photo);
    doc = setHost(doc, { ...photo, photoId: "other" });
    expect(people(doc, "host").map((p) => p.photo.photoId)).toEqual(["other"]);
    doc = toggleGuest(doc, photo);
    expect(people(doc, "guest")).toHaveLength(1);
    doc = toggleGuest(doc, photo);
    expect(people(doc, "guest")).toHaveLength(0);
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
    expect(person.photo.height * person.scale).toBeCloseTo(GUEST_HEIGHT);
  });
});

describe("button alternatives to gestures", () => {
  it("bigger and smaller scale around the centre, within the limits", () => {
    let doc = addPerson(newDocument(), photo);
    const id = doc.layers[1]!.id;
    const before = doc.layers[1]!;
    doc = scaleLayerStep(doc, id, 1);
    const after = doc.layers[1]!;
    if (before.kind !== "person" || after.kind !== "person") throw new Error();
    expect(after.scale / before.scale).toBeCloseTo(SCALE_STEP);
    expect([after.x, after.y]).toEqual([before.x, before.y]);
    for (let i = 0; i < 100; i++) doc = scaleLayerStep(doc, id, 1);
    expect(scaleLayerStep(doc, id, 1)).toBe(doc);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("the title grows from its centre, not from its corner", () => {
    let doc = newDocument();
    const t = doc.layers.find((l) => l.kind === "title")!;
    if (t.kind !== "title") throw new Error();
    const block = { width: 600, height: 200 };
    doc = scaleLayerStep(doc, t.id, 1, block);
    const next = doc.layers.find((l) => l.kind === "title")!;
    if (next.kind !== "title") throw new Error();
    expect(next.x + (600 * next.scale) / 2).toBeCloseTo(t.x + 300);
    expect(next.y + (200 * next.scale) / 2).toBeCloseTo(t.y + 100);
  });
});
