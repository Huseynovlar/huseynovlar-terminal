"""Background async worker for Huseynovlar Terminal (redundant news, corroboration, calendar, alerts)."""

from __future__ import annotations

import asyncio
import logging

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal
from app.modules.intelligence.router import run_news_refresh

logging.basicConfig(level=logging.INFO, format="%(asctime)s [worker] %(levelname)s %(message)s")
logger = logging.getLogger("terminal.worker")


async def run_worker_loop() -> None:
    logger.info("Huseynovlar Terminal Worker started (Verified News / Cross-Source Corroboration scheduler)")
    settings = get_settings()
    while True:
        try:
            async with AsyncSessionLocal() as db:
                stats = await run_news_refresh(db, settings)
                logger.info(
                    "News cycle complete: inserted=%s corroborated=%s checked=%s failed=%s",
                    stats["inserted"],
                    stats["corroborated"],
                    stats["sources_checked"],
                    len(stats["failed_sources"]),
                )
        except Exception as exc:
            logger.warning("Worker news refresh cycle failed: %s", exc)
        await asyncio.sleep(180)


if __name__ == "__main__":
    asyncio.run(run_worker_loop())
