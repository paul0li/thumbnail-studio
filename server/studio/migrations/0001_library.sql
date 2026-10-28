-- The photo library as the first version of the app created it. `IF NOT
-- EXISTS` because databases made before migrations existed already have it.
CREATE TABLE IF NOT EXISTS photos (
    id           TEXT PRIMARY KEY,
    role         TEXT NOT NULL CHECK (role IN ('background', 'person', 'logo', 'frame')),
    sha256       TEXT NOT NULL,
    path         TEXT NOT NULL,
    width        INTEGER NOT NULL,
    height       INTEGER NOT NULL,
    has_alpha    INTEGER NOT NULL,
    -- What the canvas draws: the original, or a trimmed cutout of it.
    display_path TEXT NOT NULL,
    display_width  INTEGER NOT NULL,
    display_height INTEGER NOT NULL,
    cut_out      INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS photos_by_role ON photos (role, deleted_at, created_at);
