from __future__ import annotations

from dataclasses import dataclass

from fastapi import APIRouter, FastAPI


@dataclass(frozen=True)
class ModuleSpec:
    name: str
    router: APIRouter
    prefix: str = "/api/v1"


def register_modules(app: FastAPI, modules: list[ModuleSpec]) -> None:
    """Register all feature-sliced domain modules uniformly onto the FastAPI application."""
    for mod in modules:
        app.include_router(mod.router, prefix=mod.prefix)
