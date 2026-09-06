#!/usr/bin/env python
"""Paired inference and comparability checks over two stored evaluation runs.

WHY PAIRED
    The spread between readers is far larger than the spread between two rankings of one
    reader, so a difference of run-level means carries almost no information about
    whether a scoring change did anything. Every run document records a per-user block;
    joining two of them on uid turns the comparison into the question it actually is,
    which is whether this reader's list moved and in which direction.

WHICH TEST
    Urbano, Lima and Hanjalic (SIGIR 2019, "Statistical Significance Testing in
    Information Retrieval: An Empirical Analysis of Type I, Type II and Type III
    Errors") report that the paired t-test and the permutation test agree closely on
    retrieval data, while the bootstrap-shift test is biased toward small p-values. The
    decision is therefore taken from the paired t-test, and the bootstrap is used only
    for the interval, where percentile resampling of the per-user differences is well
    behaved and makes no distributional claim.

    Ties are reported apart from the mean. A metric that moved for a handful of readers
    and stayed put for the rest produces the same mean as one that moved a little for
    everyone, and only the first of those is a null result dressed up as an effect.

    Popularity metrics are undefined rather than zero for some readers, so a pair is
    formed only where both runs define the metric, and that denominator is reported per
    metric rather than assumed to be the sample size.

POWER
    A null result is a statement about what the run could have seen, not about the
    engine. Beside every metric sits the effect detectable at POWER for the achieved n
    given the observed per-user SD of the difference, and the n that would be needed to
    detect the delta the run actually observed. The first says how small an effect this
    run was blind to; the second says whether rerunning larger would settle the question.
    Both use the normal approximation to the paired-t power calculation, which is close
    at the sample sizes in use here and does not claim a precision the SD estimate cannot
    support.

COMPARABILITY
    Three guards, because a delta between runs that do not describe the same thing is
    worse than no delta at all. What each guard withholds is decided here rather than at
    each front end, so a pair one of them refuses is refused by the other too.

    The config guard covers the fields that decide which readers are drawn and what is
    asked of the engine for each. Runs differing in any of them share no sample, and the
    uid join is meaningless even where it succeeds, so nothing is printed for such a pair.

    The overlap guard covers the reader sets themselves. Passing the config guard does not
    make two samples identical: a differing sample size under one seed normally yields a
    partial overlap rather than none, and a reader either run failed to score is absent
    from one side only. Figures joined on uid stay honest under a partial overlap and are
    printed with their denominator; a difference of run-level means does not, since each
    side is a mean over its own readers, so those are withheld.

    The switch guard covers the engine configuration each run recorded. Scoring defaults
    move, so a run taken today without switches is not the control that an unswitched run
    was when an older baseline was stored: reproducing a stored baseline means setting
    the switches that baseline recorded, not running bare. Keys present in one run and
    absent from the other are reported alongside the changed ones, since the declared
    switch list grows and an older document records fewer keys than a newer one. This one
    is reported rather than enforced: which switches differ is usually the point.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Sequence

import numpy as np
from scipy import stats

# Run-level fields that have to match before two runs are drawing from the same
# population and asking the same question of it. Mode is not among them: it names the
# sample size only, and how far two samples of different size actually overlap is
# measured from the stored per-user rows by the overlap guard rather than inferred here.
CONFIG_GUARD_KEYS = (
    "min_rated",
    "seed",
    "japanese_only",
    "holdout_fraction",
    "limit",
    "exclude_related",
)

# Fallback for a guarded key a stored run predates. A run recorded before a mode existed
# never ran under it, which reads the same as that mode being explicitly off.
CONFIG_GUARD_DEFAULTS = {"exclude_related": False}

# Per-user blocks a metric can live in, in report order.
PER_USER_BLOCKS = ("metrics", "pop_metrics")

# Resamples for the percentile interval, and a fixed seed so the same two files always
# produce the same interval. Drawn in chunks so the index matrix is never held whole.
BOOTSTRAP_RESAMPLES = 10_000
BOOTSTRAP_SEED = 987654321
BOOTSTRAP_CHUNK = 1_000

ALPHA = 0.05
POWER = 0.80


@dataclass(frozen=True)
class PairedResult:
    """One metric's paired summary across two runs."""

    metric: str
    block: str
    # Readers the metric is defined for in both runs. This is the denominator for every
    # figure below, and it is not the sample size for any metric that can be undefined.
    n: int
    changed: int
    # None where n is zero. A metric no shared reader defines has no mean difference, and
    # a zero there reads as a metric that did not move.
    mean_delta: float | None
    sd_delta: float | None
    ci_low: float | None
    ci_high: float | None
    t_statistic: float | None
    p_value: float | None
    mde: float | None
    n_for_observed: int | None


@dataclass
class Comparability:
    """What differs between two runs beyond the numbers being compared."""

    config: dict[str, tuple[Any, Any]] = field(default_factory=dict)
    switch_changed: dict[str, tuple[Any, Any]] = field(default_factory=dict)
    switch_only_previous: dict[str, Any] = field(default_factory=dict)
    switch_only_current: dict[str, Any] = field(default_factory=dict)
    paired_users: int = 0
    previous_users: int = 0
    current_users: int = 0

    @property
    def comparable(self) -> bool:
        """Whether the two runs asked the same question of the same population."""
        return not self.config

    @property
    def previous_only(self) -> int:
        """Readers the previous run scored and the current one did not."""
        return self.previous_users - self.paired_users

    @property
    def current_only(self) -> int:
        """Readers the current run scored and the previous one did not."""
        return self.current_users - self.paired_users

    @property
    def same_readers(self) -> bool:
        """Whether the two runs cover one reader set rather than two overlapping ones.

        Separate from comparable: two runs can agree on every guarded field and still be
        drawn at different sizes, or lose a different reader to a scoring failure.
        """
        return (
            self.paired_users > 0
            and self.paired_users == self.previous_users == self.current_users
        )


def _normalised(value: Any) -> Any:
    """Value in a form that survives a JSON round trip, for comparing recorded settings.

    A tuple written to a result document reads back as a list, which is not a change of
    configuration and must not be reported as one.
    """
    if isinstance(value, (list, tuple)):
        return [_normalised(item) for item in value]
    if isinstance(value, dict):
        return {key: _normalised(value[key]) for key in sorted(value)}
    return value


def per_user_index(payload: dict) -> dict[str, dict]:
    """Per-user rows of one run, keyed by uid."""
    return {row["uid"]: row for row in payload.get("per_user", [])}


def shared_metrics(previous: dict, current: dict) -> list[tuple[str, str]]:
    """Metric names both runs record per user, as (name, block) in report order.

    Read off the stored documents rather than from a fixed list, so a metric added to the
    harness is picked up and one an older run predates is skipped instead of compared
    against nothing.
    """
    prev_rows = previous.get("per_user", [])
    curr_rows = current.get("per_user", [])
    pairs: list[tuple[str, str]] = []
    for block in PER_USER_BLOCKS:
        in_previous: set[str] = set()
        for row in prev_rows:
            in_previous.update(row.get(block, {}))
        ordered: list[str] = []
        seen: set[str] = set()
        for row in curr_rows:
            for name in row.get(block, {}):
                if name not in seen:
                    seen.add(name)
                    ordered.append(name)
        pairs.extend((name, block) for name in ordered if name in in_previous)
    return pairs


def paired_values(
    prev_index: dict[str, dict],
    curr_index: dict[str, dict],
    uids: Sequence[str],
    metric: str,
    block: str,
) -> tuple[np.ndarray, np.ndarray]:
    """The two runs' values for one metric, over the readers both define it for."""
    before: list[float] = []
    after: list[float] = []
    for uid in uids:
        old = prev_index[uid].get(block, {}).get(metric)
        new = curr_index[uid].get(block, {}).get(metric)
        if old is None or new is None:
            continue
        before.append(float(old))
        after.append(float(new))
    return np.asarray(before, dtype=float), np.asarray(after, dtype=float)


def bootstrap_interval(
    deltas: np.ndarray,
    resamples: int = BOOTSTRAP_RESAMPLES,
    alpha: float = ALPHA,
    seed: int = BOOTSTRAP_SEED,
) -> tuple[float | None, float | None]:
    """Percentile interval for the mean per-user difference, resampling readers."""
    n = deltas.size
    if n < 2:
        return None, None
    rng = np.random.default_rng(seed)
    means = np.empty(resamples, dtype=float)
    drawn = 0
    while drawn < resamples:
        take = min(BOOTSTRAP_CHUNK, resamples - drawn)
        index = rng.integers(0, n, size=(take, n))
        means[drawn:drawn + take] = deltas[index].mean(axis=1)
        drawn += take
    low, high = np.percentile(means, [100.0 * alpha / 2.0, 100.0 * (1.0 - alpha / 2.0)])
    return float(low), float(high)


def _power_constant(alpha: float = ALPHA, power: float = POWER) -> float:
    """Sum of the two normal deviates a two-sided power calculation multiplies the SD by."""
    return float(stats.norm.ppf(1.0 - alpha / 2.0) + stats.norm.ppf(power))


def minimum_detectable_effect(
    sd: float, n: int, alpha: float = ALPHA, power: float = POWER
) -> float | None:
    """Smallest mean difference this many readers could detect at the stated power."""
    if n < 2 or not math.isfinite(sd) or sd <= 0.0:
        return None
    return _power_constant(alpha, power) * sd / math.sqrt(n)


def required_users(
    sd: float, delta: float, alpha: float = ALPHA, power: float = POWER
) -> int | None:
    """Readers needed to detect a difference of this size at the stated power."""
    if not math.isfinite(sd) or sd <= 0.0:
        return None
    if not math.isfinite(delta) or delta == 0.0:
        return None
    return int(math.ceil((_power_constant(alpha, power) * sd / abs(delta)) ** 2))


def analyse_metric(
    metric: str,
    block: str,
    before: np.ndarray,
    after: np.ndarray,
) -> PairedResult:
    """Paired summary of one metric from the two runs' aligned per-user values.

    A metric no shared reader defines in both runs comes back as a row with n zero and
    no figures, rather than being left out: the empty denominator is itself the finding,
    and a missing row reads as a metric neither document recorded.
    """
    deltas = after - before
    n = int(deltas.size)
    if not n:
        return PairedResult(
            metric=metric,
            block=block,
            n=0,
            changed=0,
            mean_delta=None,
            sd_delta=None,
            ci_low=None,
            ci_high=None,
            t_statistic=None,
            p_value=None,
            mde=None,
            n_for_observed=None,
        )
    changed = int(np.count_nonzero(deltas))
    mean_delta = float(deltas.mean())
    sd_delta = float(deltas.std(ddof=1)) if n > 1 else 0.0

    ci_low, ci_high = bootstrap_interval(deltas)

    # A metric no reader moved on has no variance for a test to work with, and the test
    # answers that case with a warning and a nan rather than a verdict.
    if n > 1 and sd_delta > 0.0:
        test = stats.ttest_rel(after, before)
        t_statistic = float(test.statistic)
        p_value = float(test.pvalue)
    else:
        t_statistic = None
        p_value = None

    return PairedResult(
        metric=metric,
        block=block,
        n=n,
        changed=changed,
        mean_delta=mean_delta,
        sd_delta=sd_delta,
        ci_low=ci_low,
        ci_high=ci_high,
        t_statistic=t_statistic,
        p_value=p_value,
        mde=minimum_detectable_effect(sd_delta, n),
        n_for_observed=required_users(sd_delta, mean_delta),
    )


def paired_results(
    previous: dict,
    current: dict,
    metrics: Sequence[tuple[str, str]] | None = None,
) -> list[PairedResult]:
    """Paired summary of every metric both runs record, over the readers they share."""
    prev_index = per_user_index(previous)
    curr_index = per_user_index(current)
    uids = sorted(set(prev_index) & set(curr_index))
    if not uids:
        return []
    wanted = metrics if metrics is not None else shared_metrics(previous, current)
    results = []
    for metric, block in wanted:
        before, after = paired_values(prev_index, curr_index, uids, metric, block)
        results.append(analyse_metric(metric, block, before, after))
    return results


def comparability(previous: dict, current: dict) -> Comparability:
    """Everything about two runs that decides whether the delta between them means anything."""
    # Seed sits at run level rather than in the config block, and is the field that
    # decides which readers were drawn.
    prev_config = {**previous.get("config", {}), "seed": previous.get("seed")}
    curr_config = {**current.get("config", {}), "seed": current.get("seed")}
    config_diff = {
        key: (
            prev_config.get(key, CONFIG_GUARD_DEFAULTS.get(key)),
            curr_config.get(key, CONFIG_GUARD_DEFAULTS.get(key)),
        )
        for key in CONFIG_GUARD_KEYS
        if _normalised(prev_config.get(key, CONFIG_GUARD_DEFAULTS.get(key)))
        != _normalised(curr_config.get(key, CONFIG_GUARD_DEFAULTS.get(key)))
    }

    prev_switches = previous.get("switches", {}).get("effective", {}) or {}
    curr_switches = current.get("switches", {}).get("effective", {}) or {}
    changed = {
        key: (prev_switches[key], curr_switches[key])
        for key in sorted(set(prev_switches) & set(curr_switches))
        if _normalised(prev_switches[key]) != _normalised(curr_switches[key])
    }

    prev_index = per_user_index(previous)
    curr_index = per_user_index(current)
    return Comparability(
        config=config_diff,
        switch_changed=changed,
        switch_only_previous={
            key: prev_switches[key] for key in sorted(set(prev_switches) - set(curr_switches))
        },
        switch_only_current={
            key: curr_switches[key] for key in sorted(set(curr_switches) - set(prev_switches))
        },
        paired_users=len(set(prev_index) & set(curr_index)),
        previous_users=len(prev_index),
        current_users=len(curr_index),
    )


def refuse_all_tables(report: Comparability, allow_incomparable: bool) -> str | None:
    """Why no table may be printed for this pair, or None where they may be.

    Every front end takes this decision from here, so what one of them withholds is not
    printed by the other under a different flag.
    """
    if allow_incomparable or report.comparable:
        return None
    return "the two runs were not asked the same question"


def refuse_mean_tables(report: Comparability, allow_incomparable: bool) -> str | None:
    """Why a table of run-level means may not be printed for this pair, or None.

    Stricter than the config guard, and for a different reason. Paired figures state the
    readers they cover, so a partial overlap is visible in them; a difference of means
    carries no such denominator, and two runs drawn at different sizes under one seed
    reach a partial overlap routinely.
    """
    if allow_incomparable:
        return None
    reason = refuse_all_tables(report, allow_incomparable)
    if reason or report.same_readers:
        return reason
    if not report.previous_users or not report.current_users:
        return "one of the two documents carries no per-reader rows to join on"
    if not report.paired_users:
        return "the two runs share no reader"
    return (
        f"the two runs cover different reader sets ({report.paired_users:,} shared, "
        f"{report.previous_only:,} previous only, {report.current_only:,} current only), "
        "so each side is a mean over its own readers"
    )


def _format_optional(value: float | None, width: int, places: int) -> str:
    """Right-aligned number, or a dash where there is none."""
    if value is None:
        return f"{'-':>{width}}"
    return f"{value:>{width}.{places}f}"


def print_comparability(report: Comparability, previous: dict, current: dict) -> None:
    """Print the config and switch differences between two runs.

    Printed ahead of any delta and at the same weight as one: a delta whose two sides
    were produced under different settings is describing the settings.
    """
    print()
    print("=" * 72)
    print("COMPARABILITY")
    print("=" * 72)
    print(
        f"previous: {previous.get('label')}  {previous.get('timestamp')}  "
        f"{report.previous_users:,} readers  limit={previous.get('config', {}).get('limit')}"
    )
    print(
        f"current:  {current.get('label')}  {current.get('timestamp')}  "
        f"{report.current_users:,} readers  limit={current.get('config', {}).get('limit')}"
    )
    print(f"Readers in both runs: {report.paired_users:,}")
    if report.same_readers:
        print("Both runs cover the same readers, so every figure below shares a denominator.")
    elif report.paired_users:
        print(
            f"PARTIAL OVERLAP: {report.previous_only:,} readers appear in the previous run "
            f"only and {report.current_only:,} in the current one only. Figures joined on "
            "uid cover the shared readers and report that count; a difference of run-level "
            "means would be a mean over one reader set against a mean over another."
        )
    elif not report.previous_users or not report.current_users:
        print(
            "NOT PAIRABLE: one of the two documents carries no per-reader rows. Which "
            "readers each run covered is not recorded there, so no claim about their "
            "overlap can be made either way."
        )
    else:
        print("NO OVERLAP: the two runs share no reader, so nothing can be paired.")

    if report.config:
        print()
        print("INCOMPARABLE: the two runs were not asked the same question.")
        for key, (old, new) in report.config.items():
            print(f"  config {key}: previous={old!r}  current={new!r}")
    else:
        print("Config fields under the guard agree: " + ", ".join(CONFIG_GUARD_KEYS))

    print()
    if report.switch_changed:
        print("Engine switches that differ between the two runs:")
        for key, (old, new) in report.switch_changed.items():
            print(f"  {key}: previous={old!r}  current={new!r}")
    else:
        print("No engine switch recorded by both runs differs.")

    if report.switch_only_previous:
        print("Recorded by the previous run only, so the switch list has moved since:")
        for key, value in report.switch_only_previous.items():
            print(f"  {key}={value!r}")
    if report.switch_only_current:
        print("Recorded by the current run only, so the switch list has moved since:")
        for key, value in report.switch_only_current.items():
            print(f"  {key}={value!r}")
    if report.switch_changed or report.switch_only_previous or report.switch_only_current:
        print(
            "Scoring defaults move, so an unswitched run is not the control an older "
            "unswitched run was. Reproducing a stored baseline means setting the switches "
            "that baseline recorded rather than running bare."
        )


PAIRED_HEADER = (
    f"{'metric':<22}{'n':>6}{'changed':>8}{'mean delta':>13}"
    f"{'95% CI':>24}{'sd':>10}{'t':>8}{'p':>9}{'MDE':>11}{'n@80%':>9}"
)


def print_paired_table(
    results: Sequence[PairedResult], paired_users: int | None = None
) -> None:
    """Print the paired table: delta, interval, test and power for every shared metric.

    paired_users is what distinguishes the two ways this table can come out empty, which
    are different findings about the pair and must not be reported as one.
    """
    print()
    print("=" * 72)
    print("PAIRED COMPARISON  (per reader, over readers in both runs)")
    print("=" * 72)
    if not results:
        if paired_users:
            plural = "reader appears" if paired_users == 1 else "readers appear"
            print(
                f"{paired_users:,} {plural} in both runs, but the two documents record "
                "no metric in common, so nothing can be paired."
            )
        else:
            print("No reader appears in both runs, so nothing can be paired.")
        return

    print(PAIRED_HEADER)
    print("-" * len(PAIRED_HEADER))
    for row in results:
        if not row.n:
            # Every figure on the row needs the paired denominator, so the row carries
            # that denominator and nothing else. A zero in any other column would read as
            # a measurement taken over no readers.
            print(
                f"{row.metric:<22}{row.n:>6,}"
                f"{'-':>8}{'-':>13}{'-':>24}{'-':>10}{'-':>8}{'-':>9}{'-':>11}{'-':>9}"
            )
            continue
        if row.ci_low is None or row.ci_high is None:
            interval = f"{'-':>24}"
        else:
            interval = f"[{row.ci_low:+.5f}, {row.ci_high:+.5f}]".rjust(24)
        line = (
            f"{row.metric:<22}{row.n:>6,}{row.changed:>8,}"
            f"{row.mean_delta:>+13.5f}{interval}{row.sd_delta:>10.5f}"
            + _format_optional(row.t_statistic, 8, 2)
            + _format_optional(row.p_value, 9, 4)
            + _format_optional(row.mde, 11, 5)
        )
        line += f"{'-':>9}" if row.n_for_observed is None else f"{row.n_for_observed:>9,}"
        print(line)
    print("-" * len(PAIRED_HEADER))
    print(
        "n counts the readers the metric is defined for in BOTH runs, which is below the "
        "sample for any metric that can be undefined. changed counts the readers whose "
        "value moved at all; the rest contribute a zero to the mean."
    )
    if any(not row.n for row in results):
        print(
            "A row at n 0 is a metric both documents record and no shared reader defines "
            "in both, so it has no paired denominator and no figure of any kind."
        )
    print(
        f"The interval is a {int((1 - ALPHA) * 100)}% percentile bootstrap over "
        f"{BOOTSTRAP_RESAMPLES:,} reader resamples; t and p are the paired t-test. The two "
        "answer different questions and are not required to agree at the boundary."
    )
    print(
        f"MDE is the smallest mean difference this n could detect at {int(POWER * 100)}% "
        "power given the observed spread, so a result no larger than it is a statement "
        "about the run rather than about the engine. n@80% is the readers that would be "
        "needed to detect the delta this run observed."
    )


def print_paired_comparison(
    previous: dict, current: dict, allow_incomparable: bool = False
) -> Comparability:
    """Print the comparability section and, where the pair allows it, the paired table.

    The guard runs ahead of the table rather than after it: a p-value printed above the
    notice that the two runs are not comparable has already been read.
    """
    report = comparability(previous, current)
    print_comparability(report, previous, current)
    refusal = refuse_all_tables(report, allow_incomparable)
    if refusal:
        print()
        print(
            f"Paired table withheld: {refusal}. Rerun with --allow-incomparable to see it "
            "labelled as such."
        )
        return report
    print_paired_table(paired_results(previous, current), paired_users=report.paired_users)
    if not report.comparable:
        print()
        print("The table above is INCOMPARABLE: see the config differences at the top.")
    return report
