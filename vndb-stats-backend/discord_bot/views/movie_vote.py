"""Movie Night vote views (mirrors hikaru's vote UX, single-channel + faster).

The standing vote board shows two sections - Choices (A-Z, nominator usertag,
TMDB link) and Standings (ranked by votes, %) - plus a nominee Select, a
Participants button (who voted for what) and a Manage-your-vote button. /movie_vote
opens an ephemeral copy of the same. Voting is always open unless the cycle is
paused. Persistent (timeout=None) so the board survives restarts.
"""

import logging

import discord
from discord import ui

from app.db.database import async_session_maker
from app.db.models import MovieNightCycle, MovieNomination
from app.services import movie_night_service as mn

logger = logging.getLogger(__name__)

COLOR = 0xE11D48
TMDB_MOVIE_URL = "https://www.themoviedb.org/movie/{tmdb_id}?language=ja-JP"
_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXY"  # Discord select caps at 25
_PARTICIPANTS_PAGE = 10


async def _tag(bot: discord.Client, user_id: int) -> str:
    """Resolve a user_id to a plain @username (no ping), best-effort."""
    user = bot.get_user(user_id)
    if user is not None:
        return user.name
    try:
        user = await bot.fetch_user(user_id)
        return user.name
    except Exception:
        return "unknown-user"


async def check_vote_role(interaction: discord.Interaction) -> str | None:
    """If voting is gated to a role and the member lacks it, return a rejection
    message; otherwise None (voting allowed for everyone)."""
    async with async_session_maker() as db:
        role_id = await mn.get_vote_role_id(db)
    if not role_id:
        return None
    member = interaction.user if isinstance(interaction.user, discord.Member) else None
    if member is None:
        return "You can only vote from within the server."
    if any(r.id == role_id for r in member.roles):
        return None
    return f"You need the <@&{role_id}> role to take part in Movie Night."


def _voting_closed_reason(cycle: MovieNightCycle | None) -> str | None:
    """Why a vote can't be cast, changed, or removed right now, or None if voting is
    open. Once a winner is picked the round is decided, so votes lock until the next
    round (otherwise someone could pull the vote that produced the pick)."""
    if cycle is None:
        return "Movie Night isn't running right now."
    if cycle.phase == "paused":
        return "Movie Night voting is paused right now."
    if cycle.winner_nomination_id is not None:
        return "This round's pick is locked in - voting reopens with the next round."
    return None


def build_vote_options(noms: list[MovieNomination]) -> list[discord.SelectOption]:
    options = []
    for nom in noms[:25]:
        year = f" ({nom.release_year})" if nom.release_year else ""
        options.append(discord.SelectOption(label=f"{nom.title}{year}"[:100], value=str(nom.id)))
    return options


async def build_vote_embed(bot, cycle: MovieNightCycle, standings: list[tuple[MovieNomination, int]]) -> discord.Embed:
    """Two-section embed: Choices (nomination order, A-Z) + Standings (vote order)."""
    noms_by_creation = sorted((n for n, _ in standings), key=lambda n: n.id)
    letter_of = {n.id: _LETTERS[i] for i, n in enumerate(noms_by_creation) if i < len(_LETTERS)}

    tags: dict[int, str] = {}
    for n in noms_by_creation:
        if n.nominated_by and n.nominated_by not in tags:
            tags[n.nominated_by] = await _tag(bot, n.nominated_by)

    meta = []
    if cycle.scheduled_for:
        meta.append(f"**Showtime:** <t:{int(cycle.scheduled_for.timestamp())}:F>")
    # Once a pick is made or voting is paused the deadline is moot; don't leave a stale
    # "Voting closes: X ago" line next to the pick.
    if cycle.closes_at and cycle.phase != "paused" and cycle.winner_nomination_id is None:
        meta.append(f"**Voting closes:** <t:{int(cycle.closes_at.timestamp())}:R>")

    pick_id = cycle.winner_nomination_id
    choices = []
    for i, n in enumerate(noms_by_creation):
        letter = _LETTERS[i] if i < len(_LETTERS) else "?"
        year = f" ({n.release_year})" if n.release_year else ""
        url = TMDB_MOVIE_URL.format(tmdb_id=n.tmdb_id)
        tag = tags.get(n.nominated_by, "unknown-user")
        crown = " 👑" if n.id == pick_id else ""
        choices.append(f"`{letter}` · [{n.title}{year}]({url}) · @{tag}{crown}")

    total_votes = sum(c for _, c in standings)
    standings_lines, zero = [], []
    prev_count, rank = None, 0
    for idx, (n, c) in enumerate(standings):  # standings is vote-desc from tally()
        letter = letter_of.get(n.id, "?")
        if c <= 0:
            zero.append(letter)
            continue
        if c != prev_count:
            rank = idx + 1
            prev_count = c
        pct = (c / total_votes * 100) if total_votes else 0
        standings_lines.append(f"`{rank:>2}.` `{letter}` · {n.title[:40]} · **{pct:.1f}%** ({c})")

    pick_nom = next((n for n in noms_by_creation if n.id == pick_id), None)
    lines = []
    if cycle.phase == "paused":
        lines += ["⏸ **Voting is paused.**", ""]
    lines += list(meta)
    if pick_nom:
        lines.append(f"🏆 **This week's pick:** {pick_nom.title}")
    if meta or pick_nom:
        lines.append("")
    lines.append("📋 **Choices**")
    lines += choices or ["No films yet - add one with **/movie_nominate**."]
    lines += ["", f"📊 **Standings** · {total_votes} vote{'s' if total_votes != 1 else ''}"]
    lines += standings_lines or ["_No votes yet._"]
    if zero:
        lines.append(f"_No votes: {', '.join(zero)}_")
    if cycle.winner_nomination_id is not None and cycle.phase != "paused":
        lines += ["", "🔒 Voting is closed - this round's pick is locked in."]
    else:
        lines += ["", "Tap below or use **/movie_vote** for a personal voting menu."]

    embed = discord.Embed(title="🎬 Movie Night: Vote", description="\n".join(lines)[:4000], color=COLOR)
    return embed


async def refresh_public_vote_message(bot, cycle_id: int) -> None:
    """Re-render the public vote message in place (embed + view)."""
    async with async_session_maker() as db:
        cycle = await mn.get_cycle(db, cycle_id)
        if not cycle or not cycle.message_id or not cycle.channel_id:
            return
        standings = await mn.tally(db, cycle_id)
    channel = bot.get_channel(cycle.channel_id)
    if channel is None:
        return
    try:
        msg = await channel.fetch_message(cycle.message_id)
        view = MovieVoteView(cycle.id, build_vote_options([n for n, _ in standings]))
        embed = await build_vote_embed(bot, cycle, standings)
        await msg.edit(embed=embed, view=view, allowed_mentions=discord.AllowedMentions.none())
        bot.add_view(view, message_id=cycle.message_id)
    except discord.HTTPException:
        pass


class MovieVoteSelect(ui.Select):
    def __init__(self, cycle_id: int, options: list[discord.SelectOption]):
        super().__init__(
            placeholder="Vote for a film...",
            custom_id=f"movie_vote:{cycle_id}",
            min_values=1,
            max_values=1,
            options=options or [discord.SelectOption(label="(no films yet)", value="0")],
        )
        self.cycle_id = cycle_id

    async def callback(self, interaction: discord.Interaction) -> None:
        nomination_id = int(self.values[0])
        gate = await check_vote_role(interaction)
        if gate:
            await interaction.response.send_message(
                gate, ephemeral=True, allowed_mentions=discord.AllowedMentions.none()
            )
            return
        async with async_session_maker() as db:
            cycle = await mn.get_cycle(db, self.cycle_id)
            reason = _voting_closed_reason(cycle)
            if reason:
                await interaction.response.send_message(reason, ephemeral=True)
                return
            if nomination_id == 0:
                await interaction.response.send_message(
                    "No films to vote for yet - add one with /movie_nominate.", ephemeral=True
                )
                return
            # Validate the nomination still exists in THIS cycle before casting: a
            # persistent board can outlive its pool (a film removed, or a new vote
            # started), and casting a vote for a deleted nomination would hit an FK error.
            nom = await mn.get_nomination(db, nomination_id)
            if not nom or nom.cycle_id != self.cycle_id:
                await interaction.response.send_message(
                    "That film is no longer in the pool - it may have just been picked or removed.",
                    ephemeral=True,
                )
                return
            prev = await mn.get_user_vote(db, self.cycle_id, interaction.user.id)
            replaced = prev is not None and prev.nomination_id != nomination_id
            await mn.cast_vote(db, self.cycle_id, interaction.user.id, nomination_id)
        logger.info(
            "Movie vote cast: user=%s cycle=%s nomination=%s title=%r replaced=%s",
            interaction.user.id, self.cycle_id, nomination_id, nom.title, replaced,
        )
        verb = "Replaced your vote with" if replaced else "Voted for"
        await interaction.response.send_message(f"✅ {verb} **{nom.title}**.", ephemeral=True)
        await refresh_public_vote_message(interaction.client, self.cycle_id)


class ParticipantsButton(ui.Button):
    def __init__(self, cycle_id: int):
        super().__init__(
            style=discord.ButtonStyle.secondary, emoji="👥", label="Participants",
            custom_id=f"movie_participants:{cycle_id}", row=1,
        )
        self.cycle_id = cycle_id

    async def callback(self, interaction: discord.Interaction) -> None:
        async with async_session_maker() as db:
            cycle = await mn.get_cycle(db, self.cycle_id)
            noms = await mn.list_nominations(db, self.cycle_id) if cycle else []
        if not noms:
            await interaction.response.send_message("No films in this round yet.", ephemeral=True)
            return
        view = ParticipantsView(interaction.client, self.cycle_id, noms)
        await interaction.response.send_message(embed=await view.render(), view=view, ephemeral=True)


class ManageVotesButton(ui.Button):
    def __init__(self, cycle_id: int):
        super().__init__(
            style=discord.ButtonStyle.secondary, emoji="🗑", label="Manage your vote",
            custom_id=f"movie_manage:{cycle_id}", row=1,
        )
        self.cycle_id = cycle_id

    async def callback(self, interaction: discord.Interaction) -> None:
        async with async_session_maker() as db:
            cycle = await mn.get_cycle(db, self.cycle_id)
            vote = await mn.get_user_vote(db, self.cycle_id, interaction.user.id)
            nom = await mn.get_nomination(db, vote.nomination_id) if vote else None
        if not vote or not nom:
            await interaction.response.send_message("You haven't voted in this round yet.", ephemeral=True)
            return
        reason = _voting_closed_reason(cycle)
        if reason:
            await interaction.response.send_message(f"Your vote: **{nom.title}**. {reason}", ephemeral=True)
            return
        view = ui.View(timeout=120)
        view.add_item(_RemoveVoteButton(self.cycle_id, nom.title))
        await interaction.response.send_message(
            f"Your vote: **{nom.title}**. Remove it below.", view=view, ephemeral=True
        )


class _RemoveVoteButton(ui.Button):
    def __init__(self, cycle_id: int, title: str):
        super().__init__(style=discord.ButtonStyle.danger, label=f"Remove vote ({title[:60]})")
        self.cycle_id = cycle_id
        self.title = title

    async def callback(self, interaction: discord.Interaction) -> None:
        async with async_session_maker() as db:
            cycle = await mn.get_cycle(db, self.cycle_id)
            reason = _voting_closed_reason(cycle)
            if reason:
                await interaction.response.edit_message(content=reason, view=None)
                return
            removed = await mn.remove_user_vote(db, self.cycle_id, interaction.user.id)
        if removed:
            logger.info(
                "Movie vote removed: user=%s cycle=%s title=%r",
                interaction.user.id, self.cycle_id, self.title,
            )
        await interaction.response.edit_message(content="🗑 Vote removed.", view=None)
        await refresh_public_vote_message(interaction.client, self.cycle_id)


class MovieVoteView(ui.View):
    def __init__(self, cycle_id: int, options: list[discord.SelectOption]):
        super().__init__(timeout=None)
        self.add_item(MovieVoteSelect(cycle_id, options))
        self.add_item(ParticipantsButton(cycle_id))
        self.add_item(ManageVotesButton(cycle_id))


# ── Participants panel (per-nominee voters, paginated) ─────

class ParticipantsView(ui.View):
    def __init__(self, bot, cycle_id: int, noms: list[MovieNomination]):
        super().__init__(timeout=600)
        self.bot = bot
        self.cycle_id = cycle_id
        self.noms = noms
        self.letter_of = {n.id: _LETTERS[i] for i, n in enumerate(sorted(noms, key=lambda n: n.id)) if i < len(_LETTERS)}
        self.selected = noms[0].id
        self.page = 0
        self._build()

    def _build(self) -> None:
        self.clear_items()
        self.add_item(_NomineeSelect(self))
        self.add_item(_PageButton(self, -1, "◀"))
        self.add_item(_PageButton(self, 1, "▶"))

    async def render(self) -> discord.Embed:
        async with async_session_maker() as db:
            voters = await mn.voters_for_nomination(db, self.cycle_id, self.selected)
            nom = await mn.get_nomination(db, self.selected)
        letter = self.letter_of.get(self.selected, "?")
        pages = max(1, (len(voters) + _PARTICIPANTS_PAGE - 1) // _PARTICIPANTS_PAGE)
        self.page = max(0, min(self.page, pages - 1))
        start = self.page * _PARTICIPANTS_PAGE
        slice_ = voters[start:start + _PARTICIPANTS_PAGE]
        lines = []
        for uid, ts in slice_:
            tag = await _tag(self.bot, uid)
            when = f" · <t:{int(ts.timestamp())}:R>" if ts else ""
            lines.append(f"• @{tag} (<@{uid}>){when}")
        embed = discord.Embed(
            title=f"👥 Participants · {letter} {nom.title if nom else ''}",
            description=f"**{len(voters)} voter(s)**\n" + ("\n".join(lines) or "_No votes yet._"),
            color=COLOR,
        )
        if pages > 1:
            embed.set_footer(text=f"Page {self.page + 1}/{pages}")
        return embed


class _NomineeSelect(ui.Select):
    def __init__(self, view: ParticipantsView):
        options = []
        for n in sorted(view.noms, key=lambda n: n.id)[:25]:
            letter = view.letter_of.get(n.id, "?")
            options.append(
                discord.SelectOption(
                    label=f"{letter} · {n.title}"[:100], value=str(n.id), default=(n.id == view.selected)
                )
            )
        super().__init__(placeholder="Pick a film to see who voted…", options=options, min_values=1, max_values=1)
        self.pview = view

    async def callback(self, interaction: discord.Interaction) -> None:
        self.pview.selected = int(self.values[0])
        self.pview.page = 0
        self.pview._build()
        await interaction.response.edit_message(embed=await self.pview.render(), view=self.pview)


class _PageButton(ui.Button):
    def __init__(self, view: ParticipantsView, delta: int, label: str):
        super().__init__(style=discord.ButtonStyle.secondary, label=label, row=1)
        self.pview = view
        self.delta = delta

    async def callback(self, interaction: discord.Interaction) -> None:
        self.pview.page += self.delta
        await interaction.response.edit_message(embed=await self.pview.render(), view=self.pview)


async def register_persistent_movie_views(bot: discord.Client) -> None:
    """Re-attach the standing vote board's view on boot so its buttons keep working
    through restarts (whether voting is open or paused)."""
    try:
        async with async_session_maker() as db:
            cycle = await mn.get_active_cycle(db)
            noms = await mn.list_nominations(db, cycle.id) if cycle else []
        if cycle and cycle.message_id:
            bot.add_view(MovieVoteView(cycle.id, build_vote_options(noms)), message_id=cycle.message_id)
            logger.info("Re-registered Movie Night vote view")
    except Exception as e:
        logger.error("Failed to register Movie Night vote views: %s", e, exc_info=True)
