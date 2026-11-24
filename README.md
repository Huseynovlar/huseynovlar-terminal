# Huseynovlar Terminal (`terminal.huseynovlar.org`)

Personal institutional-grade trading, analytics, and operations terminal for **Exness (MetaTrader 5)** accounts and robots — combining **Bloomberg Terminal** depth with **Apple**-level clarity.

## Key Capabilities
- **Zero-Latency MQL5 Integration:** Separate-thread `ExnessPanelBridge.mq5` + zero-network `ExnessPanelHook.mqh` (`< 0.05 ms` IPC).
- **Live Charts (`M1`–`W1`) & On-Chart Orders:** TradingView Lightweight Charts with real-time Bid/Ask, DOM / Supply & Demand / Volume Profile, active `Entry`/`SL`/`TP` lines, historical entries/exits, and multi-account (`USD` + `USC`) filtering per asset (`XAUUSD`, `USTEC`, Watchlist).
- **Global Market Intelligence:** StockCharts/Finviz-style **Market Treemap Heatmap** (NASDAQ-100, S&P 500, Global Top, Gold & Commodities), scrolling **Bloomberg Live Ticker Tape**, world news RSS/GDELT, ForexFactory High-Impact Calendar, and **Google AI (Gemini)** Co-Pilot.
- **Exness Accounting & Treasury:** Automatic `USC / 100` normalization, full Exness statements (`PDF`/`CSV`/`Excel`), Treasury/Exness Vault ledger (`DEAL_TYPE_BALANCE`), TWR ROI, Drawdown, MAE/MFE, TCA, Correlation & Stress Lab.
- **Security & Ops:** Accessible strictly inside **NetBird VPN** via **Caddy** auto-TLS (`https://terminal.huseynovlar.org`), **FIDO2 / WebAuthn Passkeys**, 2FA TOTP, AES-256-GCM secret vault, `docker-socket-proxy` container ops, opt-in Kill-Switch, Telegram alerts, and Google Drive `restic`-compatible `pg_dump` backups.

## Documentation & Progress Tracking
- **Master Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Living Roadmap & Checklist:** [docs/ROADMAP_TODO.md](docs/ROADMAP_TODO.md) — updated after every completed step/phase so development can be continued seamlessly from any session.
