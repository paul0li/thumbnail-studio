import { describe, expect, it } from "vitest";
import { newDocument, title } from "./edit";
import { applyPreset, PRESETS } from "./presets";
import { validateDocument } from "./validate";
import { updateTitle } from "./edit";

describe("presets", () => {
  it("has the five named looks and each expands into valid effects", () => {
    const labels = PRESETS.map((p) => p.label);
    for (const name of ["Contorno", "Sombra", "Neón", "Caja roja", "Eco"]) expect(labels).toContain(name);
    for (const preset of PRESETS) {
      const doc = updateTitle(newDocument("UNO DOS"), (t) => applyPreset(t, preset.id));
      expect(validateDocument(doc).ok, preset.id).toBe(true);
      expect(title(doc)!.preset).toBe(preset.id);
    }
  });

  it("red box puts a red box behind every word", () => {
    const t = applyPreset(title(newDocument("UNO DOS"))!, "red-box");
    expect(t.words.every((w) => w.box?.color === "#E92827")).toBe(true);
  });

  it("echo is stacked hard shadows", () => {
    const t = applyPreset(title(newDocument("UNO"))!, "echo");
    const shadows = t.effects.filter((e) => e.type === "dropShadow");
    expect(shadows.length).toBeGreaterThanOrEqual(2);
    expect(shadows.every((s) => s.type === "dropShadow" && s.blur === 0)).toBe(true);
  });

  it("keeps the words, their sizes and their line breaks", () => {
    const before = title(newDocument("UNO DOS TRES"))!;
    const custom = { ...before, words: before.words.map((w, i) => ({ ...w, size: 100 + i, breakBefore: i === 2 })) };
    const after = applyPreset(custom, "neon");
    expect(after.words.map((w) => [w.text, w.size, w.breakBefore])).toEqual(
      custom.words.map((w) => [w.text, w.size, w.breakBefore]),
    );
  });

  it("gives fresh effects each time, so tweaking one title never changes another", () => {
    const t = title(newDocument("UNO"))!;
    const a = applyPreset(t, "shadow");
    const b = applyPreset(t, "shadow");
    expect(a.effects).toEqual(b.effects);
    expect(a.effects[0]).not.toBe(b.effects[0]);
  });

  it("an unknown preset is an error, not a silent no-op", () => {
    expect(() => applyPreset(title(newDocument())!, "sparkles")).toThrow();
  });
});
