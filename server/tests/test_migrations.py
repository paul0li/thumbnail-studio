import json
import sqlite3
from pathlib import Path

import pytest

from studio.db import Database, Migration, load_migrations, migrate

# The library table exactly as the first version of the app created it, before
# migrations existed: no `user_version`.
UNVERSIONED_LIBRARY = """
CREATE TABLE photos (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('background', 'person', 'logo', 'frame')),
    sha256 TEXT NOT NULL, path TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
    has_alpha INTEGER NOT NULL, display_path TEXT NOT NULL, display_width INTEGER NOT NULL,
    display_height INTEGER NOT NULL, cut_out INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX photos_by_role ON photos (role, deleted_at, created_at);
"""


def photo_row(conn: sqlite3.Connection, photo_id: str, role: str, deleted: bool = False) -> None:
    conn.execute(
        """INSERT INTO photos VALUES (?, ?, 'sha', 'aa/x.png', 10, 10, 1, 'aa/x.png', 10, 10, 0,
           '2026-10-01T00:00:00.000000Z', ?)""",
        (photo_id, role, "2026-10-02T00:00:00.000000Z" if deleted else None),
    )


@pytest.fixture
def old_database(tmp_path: Path) -> Path:
    path = tmp_path / "studio.sqlite3"
    conn = sqlite3.connect(path, isolation_level=None)
    conn.executescript(UNVERSIONED_LIBRARY)
    for photo_id, role in [("bg", "background"), ("p1", "person"), ("p2", "person")]:
        photo_row(conn, photo_id, role)
    photo_row(conn, "gone", "person", deleted=True)
    conn.close()
    return path


def roles(path: Path) -> dict[str, str]:
    conn = sqlite3.connect(path)
    try:
        return dict(conn.execute("SELECT id, role FROM photos").fetchall())
    finally:
        conn.close()


def test_migrations_are_numbered_in_order_without_gaps():
    numbers = [m.number for m in load_migrations()]
    assert numbers == list(range(1, len(numbers) + 1))


def test_a_new_database_gets_every_migration(tmp_path):
    db = Database(tmp_path / "new.sqlite3")
    with db.connection() as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == len(load_migrations())


def test_a_database_from_before_migrations_keeps_every_photo_and_people_become_guests(
    old_database,
):
    Database(old_database)
    people = {"p1": "guest", "p2": "guest", "gone": "guest"}
    assert roles(old_database) == {"bg": "background", **people}


def host_document(photo_id: str, slot: str) -> str:
    return json.dumps(
        {
            "layers": [
                {"kind": "background"},
                {"kind": "person", "slot": slot, "photo": {"photoId": photo_id}},
            ]
        }
    )


def test_people_used_as_host_in_any_saved_thumbnail_become_hosts_and_the_rest_guests(
    old_database,
):
    """p1 sat in the host slot in an old version of a deleted thumbnail; p2 was
    only ever a guest; the deleted photo was never used."""
    conn = sqlite3.connect(old_database, isolation_level=None)
    before_split = [m for m in load_migrations() if not m.name.endswith("_host_and_guest.sql")]
    split = next(m for m in load_migrations() if m.name.endswith("_host_and_guest.sql"))
    migrate(conn, [m for m in before_split if m.number < split.number])
    conn.execute(
        """INSERT INTO thumbnails (id, version, title, created_at, updated_at, deleted_at)
           VALUES ('t-old-00001', 2, 'X', 'a', 'a', 'b')"""
    )
    for version, doc in [(1, host_document("p1", "host")), (2, host_document("p2", "guest"))]:
        conn.execute(
            "INSERT INTO thumbnail_versions VALUES ('t-old-00001', ?, NULL, ?, 'a')",
            (version, doc),
        )
    conn.close()
    Database(old_database)
    assert roles(old_database) == {"bg": "background", "p1": "host", "p2": "guest", "gone": "guest"}


def test_the_rebuilt_library_keeps_its_index(old_database):
    Database(old_database)
    conn = sqlite3.connect(old_database)
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index'")}
    conn.close()
    assert "photos_by_role" in names


def test_running_migrations_twice_changes_nothing(old_database):
    Database(old_database)
    before = roles(old_database)
    Database(old_database)
    assert roles(old_database) == before


def test_a_failing_migration_leaves_the_database_as_it_was(tmp_path):
    conn = sqlite3.connect(tmp_path / "x.sqlite3", isolation_level=None)
    good = Migration(1, "0001_a.sql", "CREATE TABLE a (x INTEGER);")
    bad = Migration(2, "0002_b.sql", "CREATE TABLE b (x INTEGER);\nINSERT INTO nowhere VALUES (1);")
    with pytest.raises(sqlite3.OperationalError):
        migrate(conn, [good, bad])
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert tables == {"a"}
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 1


def test_a_rebuild_that_would_lose_photos_does_not_commit(old_database, monkeypatch):
    """The host/guest rebuild checks its own row count. Here the copy is
    sabotaged to drop the deleted photo, and the migration refuses."""
    migrations = load_migrations()
    rebuild = next(m for m in migrations if m.name.endswith("_host_and_guest.sql"))
    sabotaged = rebuild.sql.replace("FROM photos;", "FROM photos WHERE deleted_at IS NULL;")
    assert sabotaged != rebuild.sql
    conn = sqlite3.connect(old_database, isolation_level=None)
    with pytest.raises(sqlite3.IntegrityError):
        before = [m for m in migrations if m.number < rebuild.number]
        migrate(conn, [*before, Migration(rebuild.number, rebuild.name, sabotaged)])
    conn.close()
    assert roles(old_database)["gone"] == "person"
