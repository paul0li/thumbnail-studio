-- «Mejorar» (ADR 0010): each run of the image engine on one version of a
-- thumbnail. Every picture of the run is kept, content-addressed: the scene
-- that was sent (without frame or logo), the overlay the browser drew (frame
-- and logo), the engine's raw output, the result with the faces restored, and
-- the final picture with the overlay on top.
CREATE TABLE improvements (
    id            TEXT PRIMARY KEY,
    thumbnail_id  TEXT NOT NULL REFERENCES thumbnails (id),
    version       INTEGER NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('running', 'ready', 'failed')),
    -- What it is doing now, or where it stopped.
    stage         TEXT NOT NULL,
    -- Why it failed: a code for the logs, and the sentence the host reads.
    failure       TEXT,
    reason        TEXT,
    engine        TEXT NOT NULL,
    model         TEXT,
    scene_path    TEXT NOT NULL,
    overlay_path  TEXT,
    raw_path      TEXT,
    restored_path TEXT,
    final_path    TEXT,
    -- JSON: the faces found and how each was registered, the read-back, usage.
    report        TEXT,
    created_at    TEXT NOT NULL,
    finished_at   TEXT,
    chosen_at     TEXT
);
CREATE INDEX improvements_by_thumbnail ON improvements (thumbnail_id, created_at);

-- «Usar esta» makes an improvement the thumbnail's download; this says which.
ALTER TABLE thumbnails ADD COLUMN export_improvement TEXT;
