"""Ceilings on the endpoints whose work is measured in seconds rather than milliseconds.

A per-caller rate limit bounds how often one visitor asks. It says nothing about how many
visitors ask at once, and the answers here are expensive enough that enough of them arriving
together starves the pool every other request shares. Anything walking the site systematically
produces exactly that shape: each individual request is unremarkable and within every limit,
while together they occupy the machine.

A ceiling turns that into a queue. One caller waits longer; everybody else is unaffected,
which is the trade worth making. Work already answered from a cache never reaches one.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import HTTPException


class Ceiling:
    """A bounded number of concurrent runs, with a wait before giving up."""

    def __init__(self, slots: int, wait_seconds: float, what: str):
        self._slots = asyncio.Semaphore(slots)
        self._wait = wait_seconds
        self._what = what

    @asynccontextmanager
    async def hold(self):
        try:
            await asyncio.wait_for(self._slots.acquire(), timeout=self._wait)
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=503,
                detail=f"Too many {self._what} are being worked out at once. Try again shortly.",
                headers={"Retry-After": "15"},
            ) from None
        try:
            yield
        finally:
            self._slots.release()
