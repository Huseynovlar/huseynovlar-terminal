from __future__ import annotations

from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings, get_settings
from app.core.database import Base, get_db
from app.main import create_app


@pytest.fixture
def test_settings() -> Settings:
    return Settings(
        ENVIRONMENT="test",
        TERMINAL_DOMAIN="terminal.huseynovlar.org",
        TERMINAL_ORIGIN="https://terminal.huseynovlar.org",
        WEBAUTHN_RP_ID="terminal.huseynovlar.org",
        JWT_SECRET_KEY="test-jwt-secret-key-at-least-32-bytes-long",
        VAULT_MASTER_KEY="test-vault-master-key-at-least-32-bytes",
        COOKIE_SECURE=False,
    )


@pytest.fixture
async def client(test_settings: Settings) -> AsyncGenerator[AsyncClient, None]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    app = create_app()

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_settings] = lambda: test_settings

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as ac:
        yield ac

    await engine.dispose()
