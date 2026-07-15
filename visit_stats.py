from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from config import VISIT_STATS_DB

DB_PATH = Path(VISIT_STATS_DB)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_visit_stats() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS visit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                visited_at TEXT NOT NULL,
                path TEXT NOT NULL,
                method TEXT NOT NULL,
                status_code INTEGER NOT NULL,
                client_host TEXT,
                user_agent TEXT,
                referer TEXT
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_visit_events_visited_at ON visit_events(visited_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_visit_events_path ON visit_events(path)")


def record_visit(path: str, method: str, status_code: int, client_host: str | None, user_agent: str | None, referer: str | None) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO visit_events (visited_at, path, method, status_code, client_host, user_agent, referer)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (_utc_now(), path[:500], method[:16], status_code, client_host, (user_agent or "")[:500], (referer or "")[:500]),
        )


def get_visit_stats() -> dict:
    init_visit_stats()
    with _connect() as conn:
        summary = conn.execute(
            """
            SELECT
                COUNT(*) AS total,
                COUNT(DISTINCT client_host) AS unique_hosts,
                SUM(CASE WHEN visited_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS last_24h,
                SUM(CASE WHEN visited_at >= datetime('now', '-7 day') THEN 1 ELSE 0 END) AS last_7d
            FROM visit_events
            """
        ).fetchone()
        top_pages = conn.execute(
            """
            SELECT path, COUNT(*) AS visits
            FROM visit_events
            GROUP BY path
            ORDER BY visits DESC, path ASC
            LIMIT 10
            """
        ).fetchall()
        daily = conn.execute(
            """
            SELECT date(visited_at) AS day, COUNT(*) AS visits, COUNT(DISTINCT client_host) AS unique_hosts
            FROM visit_events
            WHERE visited_at >= datetime('now', '-14 day')
            GROUP BY day
            ORDER BY day DESC
            """
        ).fetchall()
        recent = conn.execute(
            """
            SELECT visited_at, path, method, status_code, client_host, user_agent
            FROM visit_events
            ORDER BY id DESC
            LIMIT 25
            """
        ).fetchall()

    return {
        "summary": dict(summary),
        "top_pages": [dict(row) for row in top_pages],
        "daily": [dict(row) for row in daily],
        "recent": [dict(row) for row in recent],
    }
