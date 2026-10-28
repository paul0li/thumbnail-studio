"""SQLite with the standard library and explicit SQL.

Transactions are short by contract: no image is ever processed inside
`transaction()`. SQLite has a single writer, and keeping it free is what makes
that limit invisible.
"""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
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
"""


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            conn.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, isolation_level=None, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        return conn

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        conn = self._connect()
        try:
            yield conn
        finally:
            conn.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
            except BaseException:
                # A rollback on a closed transaction raises and would hide the
                # error we came to propagate.
                if conn.in_transaction:
                    conn.execute("ROLLBACK")
                raise
            conn.execute("COMMIT")
