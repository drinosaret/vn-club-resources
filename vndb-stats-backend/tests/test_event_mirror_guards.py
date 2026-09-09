"""Guards on the Discord side of the calendar mirror.

Source inspection rather than a live guild: the failures worth catching here are
ordering mistakes that would only show as a duplicated or wrongly deleted event
in a real server. Guarded on the module it needs, because the API image ships
discord but does not mount discord_bot/, and an unguarded import there is a
collection error that fails CI and blocks the deploy.
"""

import inspect

import pytest

mirror = pytest.importorskip("discord_bot.cogs.event_mirror")


def reconcile_source() -> str:
    return inspect.getsource(mirror.EventMirrorCog._reconcile)


def apply_source() -> str:
    return inspect.getsource(mirror.EventMirrorCog._apply)


def at(source: str, needle: str) -> int:
    index = source.find(needle)
    assert index >= 0, f"missing guard: {needle}"
    return index


def test_a_fresh_install_does_not_arm_itself():
    """Nothing is published until the mirror is switched on, so an install that
    has never been configured cannot start writing to a server."""
    source = reconcile_source()
    guard = at(source, "if not self._enabled:")
    assert guard < at(source, "await self._create("), "the switch must precede any create"
    assert guard < at(source, "await event.delete("), "the switch must precede any delete"


def test_the_permission_check_precedes_every_write():
    source = reconcile_source()
    guard = at(source, "me.guild_permissions.manage_events")
    assert guard < at(source, "await self._create(")
    assert guard < at(source, "await event.delete(")


def test_a_failed_calendar_read_changes_nothing():
    source = reconcile_source()
    bail = at(source, "The calendar could not be read")
    assert bail < at(source, "await self._create(")
    assert bail < at(source, "await event.delete(")


def test_a_failed_event_listing_changes_nothing():
    """Pruning against a read that failed would clear every mirrored event."""
    source = reconcile_source()
    bail = at(source, "The events in this server could not be read")
    assert bail < at(source, "for sync_key, row in list(mappings.items()):")
    assert bail < at(source, "await event.delete(")


def test_an_empty_window_prunes_nothing():
    """A window that yields nothing reads the same as a read gone wrong, and the
    recurring rhythms alone should always fill one."""
    source = reconcile_source()
    guard = at(source, "if not planned and mappings:")
    assert guard < at(source, "for sync_key, row in list(mappings.items()):")
    assert "mappings = {}" in source, "the leftovers have to be emptied, not just logged"


def test_only_an_event_still_to_come_is_ever_deleted():
    """Removing one that began or finished would erase something that happened."""
    source = reconcile_source()
    prune = at(source, "for sync_key, row in list(mappings.items()):")
    tail = source[prune:]
    assert at(tail, "if event.status is not discord.EventStatus.scheduled:") < at(
        tail, "await event.delete("
    )


def test_a_past_start_is_only_published_for_a_span():
    """Discord refuses a start time in the past, so a sitting that has begun is
    left alone while a stretch of days still in progress is published as running
    from now."""
    source = reconcile_source()
    guard = at(source, "if not entry.is_span:")
    assert guard < at(source, "event = await self._create(")


def test_an_event_whose_start_has_passed_keeps_its_times():
    """Whether or not Discord has marked it live: members were told when it is,
    and a start moved to now would run past the end."""
    source = apply_source()
    gate = at(source, "upcoming = event.status is discord.EventStatus.scheduled and entry.start_at > (")
    assert gate < at(source, "if upcoming:") < at(source, 'payload["start_time"]')


def test_a_mapped_event_missing_from_the_listing_is_looked_up_before_anything_is_made():
    """The listing omits canceled and completed events as well as deleted ones,
    and only a deleted one may be made again."""
    source = reconcile_source()
    lookup = at(source, "await guild.fetch_scheduled_event(row.discord_event_id)")
    assert lookup < at(source, "await self._create(")
    assert "discord.EventStatus.canceled" in source[lookup: lookup + 900]


def test_the_reconcile_is_serialised():
    """The loop and the manual run share one reconcile; two at once would each
    see the other half-finished work and create a second event for one slot."""
    assert "async with self._lock:" in inspect.getsource(mirror.EventMirrorCog.sync)


def test_adoption_never_takes_over_an_event_made_by_hand():
    source = inspect.getsource(mirror.EventMirrorCog._adoptable)
    assert "event.creator_id != me.id" in source


def test_an_unavailable_channel_stops_the_tick_rather_than_relocating_everything():
    """Falling back would rewrite every event to the generic location and write
    them all back the moment the channel returns."""
    source = reconcile_source()
    guard = at(source, "if config is None:")
    assert guard < at(source, "await self._create(")
    assert guard < at(source, "await event.delete(")
    resolve = inspect.getsource(mirror.EventMirrorCog._resolve_target)
    assert "return None" in resolve, "an unresolvable channel has to be reported, not defaulted"


def test_a_client_side_payload_error_does_not_abandon_the_tick():
    """discord.py raises TypeError for a bad field combination, which is not an
    HTTPException and would otherwise carry past the whole reconcile."""
    source = reconcile_source()
    assert source.count("(discord.HTTPException, TypeError, ValueError)") >= 3


def test_removing_by_hand_still_spares_an_event_under_way():
    source = inspect.getsource(mirror.EventMirrorCog.remove_published)
    assert at(source, "if event.status is not discord.EventStatus.scheduled:") < at(
        source, "await event.delete("
    )


def test_the_armed_session_is_read_before_the_plan_is_built():
    source = reconcile_source()
    assert at(source, "await self.armed_sessions()") < at(source, "em.plan(")
