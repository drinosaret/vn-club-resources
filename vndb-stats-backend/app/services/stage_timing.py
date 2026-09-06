"""Wall-clock accounting for the phases of one request.

A recommendation is assembled from a dozen distinct phases, most of them database
reads, and which of them dominates depends on the reader rather than on the code.
Splitting the request at the phase boundaries is the only way to answer that from a
running deployment rather than from a guess.

Timings are wall clock, not CPU: a phase that awaits a query is charged for the wait,
which is the cost that matters here. A timer belongs to a single request; sharing one
across concurrent requests would attribute one request's waiting to another.
"""

from __future__ import annotations

import time
from typing import Callable, Optional


class StageTimer:
    """Split a run at named boundaries, accumulating repeats under one name."""

    def __init__(self, clock: Callable[[], float] = time.perf_counter):
        self._clock = clock
        self._start = self._clock()
        self._last = self._start
        self._stages: dict[str, float] = {}

    def mark(self, name: str) -> float:
        """Charge the time since the previous mark to `name` and return it."""
        now = self._clock()
        elapsed = now - self._last
        self._last = now
        self._stages[name] = self._stages.get(name, 0.0) + elapsed
        return elapsed

    @property
    def elapsed(self) -> float:
        """Wall clock since the timer was made, marked or not."""
        return self._clock() - self._start

    @property
    def measured(self) -> float:
        """Wall clock charged to a stage. Below `elapsed` if a tail went unmarked."""
        return sum(self._stages.values())

    def stages(self) -> dict[str, float]:
        """Every stage in the order it was first marked."""
        return dict(self._stages)

    def breakdown(self) -> list[tuple[str, float]]:
        """Stages costliest first, ties settled by the order they were marked in."""
        order = {name: index for index, name in enumerate(self._stages)}
        return sorted(
            self._stages.items(), key=lambda item: (-item[1], order[item[0]])
        )

    def report(self, limit: Optional[int] = None) -> str:
        """One line: the total, then the costliest stages with their share of it.

        Shares are taken against the measured total rather than the wall clock, so
        they sum to 100 even when the run has an unmarked tail.
        """
        measured = self.measured
        rows = self.breakdown()
        if limit is not None:
            rows = rows[:limit]
        if measured <= 0:
            parts = [f"{name} {seconds:.3f}s" for name, seconds in rows]
        else:
            parts = [
                f"{name} {seconds:.3f}s ({seconds / measured * 100:.0f}%)"
                for name, seconds in rows
            ]
        if not parts:
            return f"{measured:.3f}s total"
        return f"{measured:.3f}s total: " + ", ".join(parts)
