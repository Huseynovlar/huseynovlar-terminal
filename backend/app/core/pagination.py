from __future__ import annotations

from typing import Any

from fastapi import Query, Response

DEFAULT_PAGE_LIMIT = 200
MAX_PAGE_LIMIT = 1000


class Page:
    """Query-param pagination dependency: ``?limit=&offset=`` (``page=`` + ``page_size=`` alias).

    List endpoints keep returning a plain JSON array (backward compatible) and expose
    ``X-Total-Count``, ``X-Limit`` and ``X-Offset`` response headers.
    """

    def __init__(
        self,
        response: Response,
        limit: int = Query(default=DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT),
        offset: int = Query(default=0, ge=0),
        page: int | None = Query(default=None, ge=1),
    ) -> None:
        self.response = response
        self.limit = limit
        self.offset = offset if page is None else (page - 1) * limit

    def set_headers(self, total: int) -> None:
        self.response.headers["X-Total-Count"] = str(total)
        self.response.headers["X-Limit"] = str(self.limit)
        self.response.headers["X-Offset"] = str(self.offset)
        self.response.headers["Access-Control-Expose-Headers"] = "X-Total-Count, X-Limit, X-Offset"

    def apply(self, items: list[Any]) -> list[Any]:
        self.set_headers(len(items))
        return items[self.offset : self.offset + self.limit]
