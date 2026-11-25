from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.db.models import StoredFile, User

router = APIRouter(prefix="/files", tags=["files"])

AVATAR_MAX_BYTES = 2 * 1024 * 1024
_IMAGE_SIGNATURES: list[tuple[bytes, str]] = [
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
]


def sniff_image_type(data: bytes) -> str | None:
    """Detect an allowed raster image type from magic bytes (SVG is intentionally rejected)."""
    for sig, mime in _IMAGE_SIGNATURES:
        if data.startswith(sig):
            return mime
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


@router.get("/{file_id}")
async def download_file(
    file_id: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Authorized private file delivery: requires a valid session (cookie/Bearer/dl_token)."""
    row = await db.get(StoredFile, file_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return Response(
        content=row.data,
        media_type=row.content_type,
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
        },
    )
