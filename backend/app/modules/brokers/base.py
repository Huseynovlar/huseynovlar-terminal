from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class BrokerConnectionResult:
    ok: bool
    broker: str
    scope: str
    latency_ms: int = 0
    http_status: int | None = None
    access_point: str | None = None
    account_id: str | None = None
    account_info: dict[str, Any] | None = None
    balance: dict[str, Any] | None = None
    error_code: str | None = None
    error: str | None = None
    hint: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "broker": self.broker,
            "scope": self.scope,
            "latency_ms": self.latency_ms,
            "http_status": self.http_status,
            "access_point": self.access_point,
            "account_id": self.account_id,
            "account_info": self.account_info,
            "balance": self.balance,
            "error_code": self.error_code,
            "error": self.error,
            "hint": self.hint,
            "details": self.details,
        }


class BrokerApiAdapter(ABC):
    """Multi-broker abstraction layer for future Exness, Interactive Brokers, Binance, etc."""

    broker_name: str = "generic"

    @abstractmethod
    async def test_connection(
        self,
        *,
        account_id: str | None = None,
        scope: str = "trading",
    ) -> BrokerConnectionResult:
        """Verify credentials, signature, and host reachability without mutating broker state."""

    @abstractmethod
    async def get_balance(self, account_id: str) -> dict[str, Any]:
        """Return transferable balance for an account."""

    @abstractmethod
    async def get_positions(self, account_id: str) -> list[dict[str, Any]]:
        """Return currently open positions for an account."""
