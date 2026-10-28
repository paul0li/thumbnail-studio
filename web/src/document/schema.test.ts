// The schema in `schema/` is what the server validates with. These tests keep
// `validate.ts` and `types.ts` saying the same thing: the shared cases must get
// the same verdict here as in pytest, and the vocabularies must match.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRESETS } from "./presets";
import { splitWords } from "./title";
import { DOCUMENT_VERSION, CANVAS_HEIGHT, CANVAS_WIDTH, EFFECTS_FOR } from "./types";
import { validateDocument } from "./validate";

const root = join(__dirname, "../../../schema");
const schema = JSON.parse(readFileSync(join(root, "design-document.schema.json"), "utf8")) as any;
interface Case {
  description: string;
  valid: boolean;
  document: unknown;
}
const cases = readdirSync(join(root, "cases"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(root, "cases", f), "utf8")) as Case] as const);

describe("the shared cases", () => {
  it.each(cases)("%s gets the same verdict as on the server", (_name, c) => {
    const result = validateDocument(c.document);
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(c.valid);
  });

  it("cover every effect and every preset", () => {
    const valid = cases.filter(([, c]) => c.valid).map(([, c]) => JSON.stringify(c.document));
    for (const type of new Set(Object.values(EFFECTS_FOR).flat())) {
      expect(valid.some((d) => d.includes(`"type":"${type}"`)), type).toBe(true);
    }
    for (const preset of PRESETS) {
      expect(valid.some((d) => d.includes(`"preset":"${preset.id}"`)), preset.id).toBe(true);
    }
  });
});

describe("the schema says what types.ts says", () => {
  const defs = schema.$defs;
  it("version and size", () => {
    expect(schema.properties.version.const).toBe(DOCUMENT_VERSION);
    expect(schema.properties.width.const).toBe(CANVAS_WIDTH);
    expect(schema.properties.height.const).toBe(CANVAS_HEIGHT);
  });

  it("which effects each layer can carry", () => {
    expect(defs.titleEffects.items.properties.type.enum).toEqual(EFFECTS_FOR.title);
    expect(defs.logoEffects.items.properties.type.enum).toEqual(EFFECTS_FOR.logo);
    expect(defs.personEffects.items.properties.type.enum).toEqual(EFFECTS_FOR.person);
  });

  it("the person slots", () => {
    expect(defs.personLayer.properties.slot.enum).toEqual(["host", "guest"]);
  });

  it("the spaces a title is split on are exactly JavaScript's", () => {
    const listed = new RegExp(defs.whitespace.const, "u");
    for (let code = 0; code <= 0xffff; code++) {
      const char = String.fromCharCode(code);
      if (/\s/u.test(char) !== listed.test(char)) throw new Error(`U+${code.toString(16)} disagrees`);
    }
    expect(splitWords("A B")).toEqual(["A", "B"]);
  });
});
