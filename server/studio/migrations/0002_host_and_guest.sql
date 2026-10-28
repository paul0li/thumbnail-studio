-- `person` splits into `host` and `guest`. SQLite cannot alter a CHECK, so the
-- table is rebuilt. Every person becomes a guest: the server has never known
-- who sat in the host slot (that lived in one browser's draft), and the app
-- moves that one photo to `host` when it adopts the draft.

CREATE TABLE photos_new (
    id           TEXT PRIMARY KEY,
    role         TEXT NOT NULL CHECK (role IN ('background', 'host', 'guest', 'logo', 'frame')),
    sha256       TEXT NOT NULL,
    path         TEXT NOT NULL,
    width        INTEGER NOT NULL,
    height       INTEGER NOT NULL,
    has_alpha    INTEGER NOT NULL,
    display_path TEXT NOT NULL,
    display_width  INTEGER NOT NULL,
    display_height INTEGER NOT NULL,
    cut_out      INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    deleted_at   TEXT
);

INSERT INTO photos_new
SELECT id, CASE role WHEN 'person' THEN 'guest' ELSE role END, sha256, path, width, height,
       has_alpha, display_path, display_width, display_height, cut_out, created_at, deleted_at
FROM photos;

-- A rebuild that loses a row must not commit. The CHECK fails, and with it the
-- whole migration, if the counts differ.
CREATE TEMP TABLE migration_check (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO migration_check
SELECT (SELECT count(*) FROM photos) = (SELECT count(*) FROM photos_new);
DROP TABLE migration_check;

DROP TABLE photos;
ALTER TABLE photos_new RENAME TO photos;
-- The index went away with the old table.
CREATE INDEX photos_by_role ON photos (role, deleted_at, created_at);
