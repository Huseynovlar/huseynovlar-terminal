"""Background async worker for Huseynovlar Terminal (redundant news, calendar, treemap, alerts)."""

from __future__ import annotations

import asyncio
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [worker] %(levelname)s %(message)s")
logger = logging.getLogger("terminal.worker")


async def run_worker_loop() -> None:
    logger.info("Huseynovlar Terminal Worker started (News / Calendar / Treemap / Alerts scheduler)")
    while True:
        await asyncio.sleep(60)


if __name__ == "__main__":
    asyncio.run(run_worker_loop())
