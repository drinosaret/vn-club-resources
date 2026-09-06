"""Splitting a run at its phase boundaries, which is how a slow request is diagnosed.

A report is read to decide what to change, so what it claims has to hold: shares against
the measured total rather than the wall clock, repeats of one phase charged together, and
the costliest phase first however the phases were ordered.
"""

from app.services.stage_timing import StageTimer


class FakeClock:
    """Advances only when told to, so a timing assertion is exact."""

    def __init__(self):
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def test_each_mark_charges_the_time_since_the_previous_one():
    clock = FakeClock()
    timer = StageTimer(clock)

    clock.advance(2.0)
    timer.mark("retrieval")
    clock.advance(0.5)
    timer.mark("scoring")

    assert timer.stages() == {"retrieval": 2.0, "scoring": 0.5}
    assert timer.measured == 2.5


def test_a_repeated_stage_accumulates_under_one_name():
    clock = FakeClock()
    timer = StageTimer(clock)

    clock.advance(1.0)
    timer.mark("retrieval")
    clock.advance(0.25)
    timer.mark("scoring")
    clock.advance(3.0)
    timer.mark("retrieval")

    assert timer.stages()["retrieval"] == 4.0
    assert timer.breakdown()[0] == ("retrieval", 4.0)


def test_an_unmarked_tail_is_outside_the_measured_total():
    clock = FakeClock()
    timer = StageTimer(clock)

    clock.advance(1.0)
    timer.mark("retrieval")
    clock.advance(9.0)

    assert timer.measured == 1.0
    assert timer.elapsed == 10.0


def test_shares_are_taken_against_what_was_measured():
    clock = FakeClock()
    timer = StageTimer(clock)

    clock.advance(3.0)
    timer.mark("retrieval")
    clock.advance(1.0)
    timer.mark("scoring")
    clock.advance(50.0)  # unmarked, so it takes no share

    report = timer.report()
    assert report.startswith("4.000s total:")
    assert "retrieval 3.000s (75%)" in report
    assert "scoring 1.000s (25%)" in report


def test_the_report_names_the_costliest_stages_first_and_can_be_cut_short():
    clock = FakeClock()
    timer = StageTimer(clock)

    clock.advance(0.1)
    timer.mark("cheap")
    clock.advance(5.0)
    timer.mark("dear")

    assert timer.report(limit=1) == "5.100s total: dear 5.000s (98%)"


def test_a_run_with_no_marks_still_reports():
    timer = StageTimer(FakeClock())

    assert timer.report() == "0.000s total"
