from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

_engine: Engine | None = None
_session_factory: sessionmaker | None = None


def get_database_url() -> str:
    database_url = settings.database_url.strip() if settings and settings.database_url else ""
    if not database_url:
        database_url = "postgresql+psycopg://neondb_owner:npg_6JgE1mbktdWf@ep-damp-fire-b19ookvd-pooler.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require"
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return database_url



def create_engine_from_settings() -> Engine:
    database_url = get_database_url()
    url = make_url(database_url)

    connect_args: dict[str, object] = {}
    if url.drivername.startswith("postgresql"):
        connect_args["connect_timeout"] = settings.database_connect_timeout

    return create_engine(
        database_url,
        echo=settings.database_echo,
        pool_pre_ping=settings.database_pool_pre_ping,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        future=True,
        connect_args=connect_args,
    )


def create_session_factory() -> sessionmaker:
    return sessionmaker(
        bind=create_engine_from_settings(),
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine_from_settings()
    return _engine


def get_session_factory() -> sessionmaker:
    global _session_factory
    if _session_factory is None:
        _session_factory = sessionmaker(
            bind=get_engine(),
            autoflush=False,
            autocommit=False,
            expire_on_commit=False,
        )
    return _session_factory


def reset_session_state() -> None:
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _session_factory = None


@contextmanager
def session_scope() -> Session:
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def new_session() -> Session:
    return sessionmaker(
        bind=get_engine(),
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )()
