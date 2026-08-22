"""Sample floors shared between the boards that apply them and the text that discloses them.

These live apart from both because they are needed in both directions: the nightly job
enforces them, and the registry quotes them in the "how this is counted" panel. Keeping one
definition is what stops a board from advertising a floor it does not apply, which is the
one kind of error in a disclosure that is worse than saying nothing.
"""

from __future__ import annotations

# ---------------------------------------------------------------- reader response

#: Consensus is only meaningful where enough people have voted, and a reader is only
#: comparable to it on titles that cleared that bar.
MIN_VOTES_FOR_CONSENSUS = 30

#: Votes a reader needs before their response to consensus is estimated at all.
MIN_VOTES_FOR_RESPONSE = 100

#: How much of the variation in a reader's votes the community average has to account for
#: before the slope is treated as describing them. Below this the line is drawn through a
#: cloud, and its steepness is an artefact of the scatter rather than a trait.
MIN_RESPONSE_FIT = 0.30

#: Damping weight for the response slope, in votes. A reader at the floor is pulled halfway
#: back to consensus; one with a thousand comparable votes is barely moved.
RESPONSE_PRIOR = 100.0

# ---------------------------------------------------------------- reading rhythm

#: Below this a reader's monthly histogram is too sparse for its evenness to mean anything.
MIN_VOTES_FOR_STEADINESS = 150

#: A rhythm needs long enough to be a rhythm. Five years of months.
MIN_SPAN_FOR_STEADINESS = 60

# ---------------------------------------------------------------- stopping points

#: Votes a reader needs before their stopping point says anything about a title.
MIN_VOTES_FOR_TERMINAL = 20

#: How long a reader has to have been silent before their last vote counts as their last.
#: Without this every reader who simply has not voted again yet is treated as gone, and the
#: board becomes a ranking of whatever came out most recently.
TERMINAL_SILENCE_DAYS = 365

#: How long a title needs to have been out before its stopping rate is judged, so it has a
#: settled population of readers rather than only the ones who reached it immediately.
TERMINAL_MATURITY_DAYS = 1095

#: Floors on the title side: enough readers to have an expectation, and enough observed
#: stopping points that the ratio is not one or two people.
MIN_RATERS_FOR_TERMINAL = 250
MIN_TERMINAL_OBSERVED = 15

# ---------------------------------------------------------------- per-title averages

#: List entries a title needs before its drop rate is allowed to speak for a tag. A title
#: three people opened says nothing about whether a genre gets finished.
MIN_LIST_ENTRIES_FOR_RATE = 30

#: Votes a title needs before the share of them that arrived this year means anything.
MIN_VOTES_FOR_RECENCY = 30

# ---------------------------------------------------------------- franchises

#: Votes an entry needs before it is allowed to set a franchise's first or last date. An
#: unvoted entry is usually a catalogue fragment, and one of those at either end moves the
#: span by years while representing nothing anybody read.
MIN_VOTES_PER_SERIES_ENTRY = 20

# ---------------------------------------------------------------- library composition

#: Votes a reader needs before any share of their library is computed. One pre-floor for the
#: scan; each board then applies its own, which is never lower than this.
MIN_VOTES_FOR_COMPOSITION = 40

#: Titles a reader needs before a share of their library is published. High enough that a
#: percentage is not one or two titles, low enough that the field is thousands of readers.
MIN_LIBRARY_FOR_SHARE = 100

# ---------------------------------------------------------------- backlog against reading

#: Entries a reader needs on each side before their backlog is compared with their reading.
#: Both sides carry it: a long wishlist against four finished titles says nothing about either.
MIN_PER_SIDE_FOR_BACKLOG = 25
