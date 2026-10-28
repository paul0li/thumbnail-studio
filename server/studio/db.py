"""SQLite with the standard library and explicit SQL.

Transactions are short by contract: no image is ever processed inside
`transaction()`. SQLite has a single writer, and keeping it free is what makes
that limit invisible.

The schema is the migrations in `migrations/`, applied in order. Each one runs
in its own transaction together with the bump of `PRAGMA user_version`, so a
migration is either fully applied or not at all.
"""

import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
_NAME = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")


@dataclass(frozen=True)
class Migration:
    number: int
    name: str
    sql: str


def load_migrations(directory: Path = MIGRATIONS_DIR) -> list[Migration]:
    found = []
    for path in directory.iterdir():
        match = _NAME.match(path.name)
        if match:
            found.append(Migration(int(match.group(1)), path.name, path.read_text()))
    found.sort(key=lambda m: m.number)
    numbers = [m.number for m in found]
    if numbers != list(range(1, len(found) + 1)):
        raise RuntimeError(f"migrations must be numbered 1..n without gaps, found {numbers}")
    return found


def statements(sql: str) -> Iterator[str]:
    """Splits a script into statements. `executescript` would be simpler, but it
    commits any open transaction before it starts, so a migration could not run
    inside the same transaction that records it."""
    buffer = ""
    for line in sql.splitlines(keepends=True):
        buffer += line
        if sqlite3.complete_statement(buffer):
            yield buffer.strip()
            buffer = ""
    if any(line.strip() and not line.strip().startswith("--") for line in buffer.splitlines()):
        raise ValueError("migration ends with an incomplete statement")


def migrate(conn: sqlite3.Connection, migrations: list[Migration] | None = None) -> int:
    """Applies what is missing, in order. Returns the schema version after."""
    for migration in migrations if migrations is not None else load_migrations():
        conn.execute("BEGIN IMMEDIATE")
        try:
            # Read inside the write lock: another process may have just applied it.
            current = conn.execute("PRAGMA user_version").fetchone()[0]
            if current >= migration.number:
                conn.execute("COMMIT")
                continue
            for statement in statements(migration.sql):
                conn.execute(statement)
            conn.execute(f"PRAGMA user_version = {migration.number}")
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
        conn.execute("COMMIT")
    return conn.execute("PRAGMA user_version").fetchone()[0]


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            migrate(conn)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, isolation_level=None, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA foreign_keys = ON")
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
