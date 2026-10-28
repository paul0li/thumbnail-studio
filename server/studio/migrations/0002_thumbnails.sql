-- Saved thumbnails. A thumbnail is a row with its head version; every save of
-- its design document is a row in `thumbnail_versions`.
--
-- `parent` is the version one undo step back, not simply the previous number:
-- undoing and then saving appends a new version whose parent is the parent of
-- the state it went back to. Walking `parent` from the head gives the undo
-- history after a reload, without replaying anything.
CREATE TABLE thumbnails (
    id              TEXT PRIMARY KEY,
    version         INTEGER NOT NULL,
    title           TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    -- A small picture for the history, drawn by the browser after a save.
    preview_path    TEXT,
    preview_version INTEGER,
    -- The 1280x720 PNG of the last download, and which version it shows.
    export_path     TEXT,
    export_version  INTEGER,
    exported_at     TEXT,
    deleted_at      TEXT
);
CREATE INDEX thumbnails_recent ON thumbnails (deleted_at, updated_at);

CREATE TABLE thumbnail_versions (
    thumbnail_id TEXT NOT NULL REFERENCES thumbnails (id),
    version      INTEGER NOT NULL,
    parent       INTEGER,
    document     TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (thumbnail_id, version)
);
