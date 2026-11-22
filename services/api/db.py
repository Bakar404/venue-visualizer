from contextlib import contextmanager
from pathlib import Path
from secrets import token_hex

from sqlalchemy import URL, event, text
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

from .models import SchemaVersion, Settings

VERSION = 5
_DEVICE_SECONDS = 30 * 24 * 60 * 60


def database(data_dir: Path) -> Engine:
    data_dir.mkdir(parents=True, exist_ok=True)
    engine = create_engine(URL.create("sqlite", database=str(data_dir / "venue-visualizer.sqlite")))

    @event.listens_for(engine, "connect")
    def sqlite_settings(connection, _record):
        cursor = connection.cursor()
        try:
            cursor.execute("PRAGMA busy_timeout = 10000")
            cursor.execute("PRAGMA foreign_keys = ON")
        finally:
            cursor.close()

    return engine


def initialize(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.exec_driver_sql("PRAGMA journal_mode = WAL")
        conn.exec_driver_sql("BEGIN IMMEDIATE")
        SchemaVersion.__table__.create(conn, checkfirst=True)
        version = conn.execute(text("SELECT MAX(version) FROM schema_version")).scalar_one()
        if version not in (None, 1, 2, 3, 4, VERSION):
            raise RuntimeError(f"Unsupported database schema version: {version}; expected {VERSION}")
        SQLModel.metadata.create_all(conn)
        if version == 4:
            conn.exec_driver_sql("ALTER TABLE landevice ADD COLUMN id VARCHAR")
            conn.exec_driver_sql("ALTER TABLE landevice ADD COLUMN label VARCHAR NOT NULL DEFAULT 'Unknown device'")
            conn.exec_driver_sql("ALTER TABLE landevice ADD COLUMN paired_at INTEGER NOT NULL DEFAULT 0")
            conn.exec_driver_sql("ALTER TABLE landevice ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0")
            conn.execute(text(
                "UPDATE landevice SET id = lower(hex(randomblob(16))), paired_at = expires_at - :seconds, "
                "last_seen = expires_at - :seconds"
            ), {"seconds": _DEVICE_SECONDS})
            conn.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS ix_landevice_id ON landevice (id)")
        if version == 1:
            conn.exec_driver_sql("ALTER TABLE space ADD COLUMN capacity_seated INTEGER")
            conn.exec_driver_sql("ALTER TABLE space ADD COLUMN capacity_standing INTEGER")
            conn.exec_driver_sql("ALTER TABLE space ADD COLUMN source VARCHAR")
        if version in (1, 2):
            conn.exec_driver_sql("ALTER TABLE chatmessage ADD COLUMN chat_meta_json JSON")
        if version != VERSION:
            conn.execute(
                insert(Settings).values(id=1, values_json={}, lan_signing_key=token_hex(32))
                .on_conflict_do_nothing(index_elements=["id"])
            )
            conn.execute(text("INSERT INTO schema_version (version) VALUES (:version)"), {"version": VERSION})


@contextmanager
def write_session(engine: Engine):
    with Session(engine, expire_on_commit=False) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        yield session
        session.commit()
