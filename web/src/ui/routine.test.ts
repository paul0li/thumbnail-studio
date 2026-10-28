import { describe, expect, it } from "vitest";
import type { Photo } from "../api";
import { addPerson, newDocument, people, setFrame } from "../document/edit";
import { validateDocument } from "../document/validate";
import { missing, isTitleDone } from "./progress";
import { startOfDay } from "./routine";

const photo = (id: string, role: Photo["role"]): Photo => ({
  id,
  role,
  width: 400,
  height: 800,
  url: `/api/files/${id}.png`,
  original_url: `/api/files/${id}.png`,
  has_alpha: true,
  cut_out: false,
  created_at: "2026-01-01T00:00:00.000000Z",
});

describe("a new thumbnail starts like every day", () => {
  const library = [photo("frame-new", "frame"), photo("frame-old", "frame"), photo("logo", "logo"), photo("host", "person"), photo("guest", "person")];

  it("puts on the newest frame and logo the first time", () => {
    const doc = startOfDay(null, library);
    const kinds = doc.layers.map((l) => l.kind);
    expect(kinds.at(-1)).toBe("frame");
    expect(doc.layers.at(-1)).toMatchObject({ kind: "frame", photo: { photoId: "frame-new" } });
    expect(kinds).toContain("logo");
    expect(people(doc)).toHaveLength(0);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("keeps yesterday's frame and host, but not the guests or the title", () => {
    let yesterday = setFrame(newDocument("AYER"), { photoId: "frame-old", src: "/f.png", width: 1280, height: 720 });
    yesterday = addPerson(yesterday, { photoId: "host", src: "/h.png", width: 400, height: 800 }, "host");
    yesterday = addPerson(yesterday, { photoId: "guest", src: "/g.png", width: 400, height: 800 }, "guest");
    const doc = startOfDay(yesterday, library);
    expect(doc.layers.at(-1)).toMatchObject({ kind: "frame", photo: { photoId: "frame-old" } });
    expect(people(doc, "host").map((p) => p.photo.photoId)).toEqual(["host"]);
    expect(people(doc, "guest")).toHaveLength(0);
    expect(doc.layers.find((l) => l.kind === "title")).toMatchObject({ preset: "brand", accent: "#E92827" });
  });

  it("skips what is no longer in the library", () => {
    let yesterday = addPerson(newDocument(), { photoId: "gone", src: "/x.png", width: 4, height: 8 }, "host");
    yesterday = setFrame(yesterday, { photoId: "gone-frame", src: "/f.png", width: 1280, height: 720 });
    const doc = startOfDay(yesterday, library);
    expect(people(doc, "host")).toHaveLength(0);
    expect(doc.layers.at(-1)).toMatchObject({ kind: "frame", photo: { photoId: "frame-new" } });
  });
});

describe("progress in words", () => {
  it("the sample title does not count as written", () => {
    expect(isTitleDone("ESCRIBE EL TÍTULO")).toBe(false);
    expect(isTitleDone("  ")).toBe(false);
    expect(isTitleDone("NADIE LO VIO")).toBe(true);
  });

  it("says what is left", () => {
    expect(missing([])).toBeNull();
    expect(missing(["Fondo"])).toBe("Falta: fondo.");
    expect(missing(["Conductor", "Fondo", "Título"])).toBe("Falta: conductor, fondo y título.");
  });
});
