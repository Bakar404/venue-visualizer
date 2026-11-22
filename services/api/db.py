from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import URL, event, text
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

from .models import SchemaVersion

VERSION = 3


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
        if version not in (None, 1, 2, VERSION):
            raise RuntimeError(f"Unsupported database schema version: {version}; expected {VERSION}")
        SQLModel.metadata.create_all(conn)
        if version == 1:
            conn.exec_driver_sql("ALTER TABLE space ADD COLUMN capacity_seated INTEGER")
            conn.exec_driver_sql("ALTER TABLE space ADD COLUMN capacity_standing INTEGER")
            conn.exec_driver_sql("ALTER TABLE space ADD COLUMN source VARCHAR")
        if version in (1, 2):
            conn.exec_driver_sql("ALTER TABLE chatmessage ADD COLUMN chat_meta_json JSON")
        if version != VERSION:
            conn.execute(text("INSERT INTO schema_version (version) VALUES (:version)"), {"version": VERSION})


@contextmanager
def write_session(engine: Engine):
    with Session(engine, expire_on_commit=False) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        yield session
        session.commit()
