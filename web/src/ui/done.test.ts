import { describe, expect, it } from "vitest";
import type { Improvement } from "../api";
import { doneWords, keptFrom, reopenView } from "./done";

describe("the done screen", () => {
  it("shows the improved picture with «Descargar de nuevo» when there is one", () => {
    const words = doneWords({ kept: { version: 4 }, version: 4, downloaded: null });
    expect(words.improved).toBe(true);
    expect(words.primary).toBe("Descargar de nuevo");
    expect(words.stale).toBeNull();
    expect(words.text).toMatch(/^La mejorada quedó guardada/);
  });

  it("says it is on her phone after «Usar esta»", () => {
    expect(doneWords({ kept: { version: 4 }, version: 4, downloaded: "improved" }).text).toMatch(/^Quedó la mejorada en tu teléfono/);
  });

  it("says plainly when the improved picture is from before her latest changes", () => {
    expect(doneWords({ kept: { version: 4 }, version: 6, downloaded: null }).stale).toBe("Mejorada antes de tus últimos cambios");
  });

  it("is about her own picture right after she downloads her own, and without an improvement", () => {
    for (const words of [
      doneWords({ kept: { version: 4 }, version: 4, downloaded: "mine" }),
      doneWords({ kept: null, version: 4, downloaded: null }),
    ]) {
      expect(words.improved).toBe(false);
      expect(words.primary).toBe("Descargar otra vez");
    }
  });
});

describe("reopening a thumbnail from «Mis miniaturas»", () => {
  it("opens on the done screen when it has an improved picture", () => {
    expect(reopenView({ kept: true, run: "ready", left: "improve" })).toBe("done");
    expect(reopenView({ kept: true, run: null, left: "title" })).toBe("done");
  });

  it("shows a run that is still going, or one that failed while she was away", () => {
    expect(reopenView({ kept: true, run: "running", left: "title" })).toBe("improve");
    expect(reopenView({ kept: true, run: "failed", left: "improve" })).toBe("improve");
    expect(reopenView({ kept: true, run: "failed", left: "title" })).toBe("done");
  });

  it("opens where she left it when nothing was improved", () => {
    expect(reopenView({ kept: false, run: null, left: "title" })).toBeNull();
  });
});

describe("keeping an improvement", () => {
  const run: Improvement = {
    id: "imp1",
    thumbnail_id: "t-1",
    version: 2,
    status: "ready",
    stage: "done",
    failure: null,
    reason: null,
    final_url: "/api/files/ab/final.png",
    created_at: "",
    finished_at: "2026-10-28T10:01:00Z",
    chosen: false,
  };

  it("keeps only a run that ended with a picture", () => {
    expect(keptFrom(run)).toEqual({ id: "imp1", version: 2, url: "/api/files/ab/final.png", finished_at: run.finished_at, chosen: false });
    expect(keptFrom({ ...run, status: "failed", final_url: null })).toBeNull();
    expect(keptFrom({ ...run, status: "running", final_url: null })).toBeNull();
  });
});
