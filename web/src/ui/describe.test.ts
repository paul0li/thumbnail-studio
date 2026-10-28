import { describe, expect, it } from "vitest";
import { addPerson, newDocument, placeLayer, setLogo } from "../document/edit";
import type { PhotoRef } from "../document/types";
import { describeDocument, layerName, whereIs } from "./describe";

const photo: PhotoRef = { photoId: "p", src: "/x.png", width: 500, height: 1000 };

describe("the thumbnail in words", () => {
  it("names the host, and guests by number only when there is more than one", () => {
    const one = addPerson(newDocument(), photo);
    expect(layerName(one, one.layers[1]!)).toBe("Invitado");
    const two = addPerson(addPerson(one, photo), photo, "host");
    const people = two.layers.filter((l) => l.kind === "person");
    expect(people.map((p) => layerName(two, p))).toEqual(["Conductor", "Invitado 1", "Invitado 2"]);
  });

  it("says where things are in plain words", () => {
    expect(whereIs(100, 100)).toBe("arriba a la izquierda");
    expect(whereIs(640, 360)).toBe("al centro");
    expect(whereIs(1200, 700)).toBe("abajo a la derecha");
  });

  it("describes the layers from the front, with the exact title", () => {
    let doc = setLogo(addPerson(newDocument("NADIE LO VIO"), photo), photo);
    const logo = doc.layers.find((l) => l.kind === "logo")!;
    doc = placeLayer(doc, logo.id, 100, 80);
    expect(describeDocument(doc)).toBe(
      "Logo arriba a la izquierda. Título: «NADIE LO VIO». Invitado abajo a la izquierda. Fondo oscuro sin foto.",
    );
  });
});
