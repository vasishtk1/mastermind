"""Async SQLAlchemy 2.0 engine, session factory, and FastAPI dependency.

Database: SQLite via aiosqlite for local development.
In production swap the URL for postgresql+asyncpg://... and everything else
stays the same — SQLAlchemy's async abstraction is database-agnostic.
"""

from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------
SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./ember.db"

engine = create_async_engine(
    SQLALCHEMY_DATABASE_URL,
    # echo=True is useful for debugging queries; keep False in production.
    echo=False,
    # SQLite-specific: allow the same connection to be used across threads
    # (needed because asyncio may switch coroutines mid-transaction).
    connect_args={"check_same_thread": False},
)

# ---------------------------------------------------------------------------
# Session factory
# ---------------------------------------------------------------------------
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,  # keep ORM objects usable after commit
    class_=AsyncSession,
)


# ---------------------------------------------------------------------------
# Declarative base — imported by db_models.py
# ---------------------------------------------------------------------------
class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield an async DB session; commit on success, rollback on error."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
