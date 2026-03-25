"""Security-related tests for hardening changes.

Tests cover: path traversal, table name validation, URL validation,
JSON key round-trip for graph mappings, and Turnstile config defaults.
"""

import json
import os
import re
import tempfile

import pytest


# ---------------------------------------------------------------------------
# graph_builder: JSON key round-trip
# ---------------------------------------------------------------------------

# Inline the restore function so tests don't need torch/sqlalchemy imports
_STRING_KEY_NODE_TYPES = frozenset({"user"})


def _restore_mapping_key_types(mappings: dict) -> dict:
    restored = {}
    for node_type, id_map in mappings.items():
        if node_type in _STRING_KEY_NODE_TYPES:
            restored[node_type] = id_map
        else:
            restored[node_type] = {int(k): v for k, v in id_map.items()}
    return restored


class TestGraphBuilderMappings:
    """Verify JSON serialization preserves mapping key types."""

    SAMPLE_MAPPINGS = {
        "user": {"abc123hash": 0, "def456hash": 1},
        "vn": {12345: 0, 67890: 1, 111: 2},
        "tag": {1: 0, 2: 1, 55: 2},
        "staff": {100: 0, 200: 1},
        "producer": {300: 0},
        "character": {5000: 0, 5001: 1},
        "trait": {10: 0, 20: 1},
    }

    def test_json_stringifies_int_keys(self):
        loaded = json.loads(json.dumps(self.SAMPLE_MAPPINGS))
        assert isinstance(list(loaded["vn"].keys())[0], str)
        assert loaded["vn"].get(12345) is None

    def test_restore_recovers_int_keys(self):
        loaded = json.loads(json.dumps(self.SAMPLE_MAPPINGS))
        restored = _restore_mapping_key_types(loaded)
        assert restored["vn"][12345] == 0
        assert restored["tag"][55] == 2
        assert restored["staff"][200] == 1
        assert restored["character"][5001] == 1

    def test_user_keys_stay_as_strings(self):
        loaded = json.loads(json.dumps(self.SAMPLE_MAPPINGS))
        restored = _restore_mapping_key_types(loaded)
        assert isinstance(list(restored["user"].keys())[0], str)
        assert restored["user"]["abc123hash"] == 0

    def test_full_round_trip_matches(self):
        loaded = json.loads(json.dumps(self.SAMPLE_MAPPINGS))
        restored = _restore_mapping_key_types(loaded)
        assert restored == self.SAMPLE_MAPPINGS

    def test_empty_mappings(self):
        result = _restore_mapping_key_types({})
        assert result == {}

    def test_empty_node_type(self):
        result = _restore_mapping_key_types({"vn": {}, "user": {}})
        assert result == {"vn": {}, "user": {}}


# ---------------------------------------------------------------------------
# importer: table name validation
# ---------------------------------------------------------------------------

_TABLE_NAME_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def _validate_table_name(name: str) -> str:
    if not _TABLE_NAME_RE.match(name):
        raise ValueError(f"Unsafe table name: {name!r}")
    return name


class TestTableNameValidation:
    """Ensure SQL identifier validation rejects injection attempts."""

    @pytest.mark.parametrize(
        "name",
        [
            "visual_novels",
            "tags",
            "vn_tags",
            "characters",
            "releases_staging",
            "A",
            "_private",
        ],
    )
    def test_valid_names(self, name):
        assert _validate_table_name(name) == name

    @pytest.mark.parametrize(
        "name",
        [
            "visual_novels; DROP TABLE users",
            "tags--",
            "table name",
            "123start",
            "",
            "a.b",
            "a/b",
            "table\x00null",
            "'; DROP TABLE",
        ],
    )
    def test_injection_attempts_rejected(self, name):
        with pytest.raises(ValueError, match="Unsafe table name"):
            _validate_table_name(name)


# ---------------------------------------------------------------------------
# dump_downloader: path traversal protection
# ---------------------------------------------------------------------------


class TestPathTraversal:
    """Verify tar extraction path traversal checks."""

    @staticmethod
    def _check_tar_member(member_name: str, output_dir: str) -> bool:
        if os.path.isabs(member_name) or ".." in member_name:
            return False
        dest = os.path.realpath(os.path.join(output_dir, member_name))
        if not dest.startswith(os.path.realpath(output_dir) + os.sep):
            return False
        return True

    def test_valid_paths(self):
        with tempfile.TemporaryDirectory() as d:
            assert self._check_tar_member("db/vndb-vns-latest.jsonl", d)
            assert self._check_tar_member("file.json", d)
            assert self._check_tar_member("a/b/c.txt", d)

    def test_dotdot_blocked(self):
        with tempfile.TemporaryDirectory() as d:
            assert not self._check_tar_member("../../../etc/passwd", d)
            assert not self._check_tar_member("foo/../../etc/passwd", d)

    def test_absolute_blocked(self):
        with tempfile.TemporaryDirectory() as d:
            assert not self._check_tar_member("/etc/passwd", d)
            assert not self._check_tar_member("C:\\Windows\\System32\\cmd.exe", d)


# ---------------------------------------------------------------------------
# announcement modal: URL validation
# ---------------------------------------------------------------------------

from urllib.parse import urlparse


def _is_valid_http_url(url: str | None) -> bool:
    if not url:
        return True
    try:
        parsed = urlparse(url)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False


class TestAnnouncementUrlValidation:
    """Ensure announcement URLs only allow http/https."""

    @pytest.mark.parametrize(
        "url",
        [
            "https://example.com",
            "http://example.com/path",
            "https://cdn.example.com/img.png",
        ],
    )
    def test_valid_urls(self, url):
        assert _is_valid_http_url(url) is True

    def test_empty_and_none_are_ok(self):
        assert _is_valid_http_url(None) is True
        assert _is_valid_http_url("") is True

    @pytest.mark.parametrize(
        "url",
        [
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "ftp://evil.com/file",
            "file:///etc/passwd",
            "not-a-url",
            "//evil.com",
        ],
    )
    def test_dangerous_urls_blocked(self, url):
        assert _is_valid_http_url(url) is False


# ---------------------------------------------------------------------------
# VNDescription: URL validation (frontend logic, tested in Python equivalent)
# ---------------------------------------------------------------------------


def _is_valid_vn_url(url: str) -> bool:
    """Python equivalent of isValidUrl from VNDescription.tsx.

    JS ``new URL(url)`` throws for relative paths like ``/vn/v17``,
    falling through to the catch branch.  Python's ``urlparse`` never
    throws, so we replicate the JS behaviour: if ``urlparse`` returns a
    scheme, it was an absolute URL; otherwise treat it like the JS catch
    branch.
    """
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if parsed.scheme:
        # Absolute URL - only allow http/https
        return parsed.scheme in ("http", "https")
    # No scheme - mirrors the JS catch branch
    lower = url.lower().strip()
    if any(
        lower.startswith(p)
        for p in ("javascript:", "data:", "vbscript:")
    ):
        return False
    return (url.startswith("/") and not url.startswith("//")) or url.startswith("#") or url.startswith("?")


class TestVNDescriptionUrlValidation:
    def test_http_allowed(self):
        assert _is_valid_vn_url("https://vndb.org") is True
        assert _is_valid_vn_url("http://example.com") is True

    def test_relative_paths_allowed(self):
        assert _is_valid_vn_url("/vn/v17") is True
        assert _is_valid_vn_url("#section") is True
        assert _is_valid_vn_url("?q=test") is True

    def test_protocol_relative_blocked(self):
        assert _is_valid_vn_url("//evil.com/path") is False

    def test_dangerous_schemes_blocked(self):
        assert _is_valid_vn_url("javascript:alert(1)") is False
        assert _is_valid_vn_url("data:text/html,hi") is False
        assert _is_valid_vn_url("vbscript:msgbox") is False


# ---------------------------------------------------------------------------
# config: Turnstile fail-closed default
# ---------------------------------------------------------------------------


_has_pydantic_settings = bool(
    __import__("importlib").util.find_spec("pydantic_settings")
)


@pytest.mark.skipif(not _has_pydantic_settings, reason="pydantic_settings not installed")
class TestTurnstileConfig:
    def test_default_fail_closed(self):
        from app.config import Settings

        s = Settings(
            _env_file=None,
            database_url="postgresql+asyncpg://test:test@localhost/test",
        )
        assert s.turnstile_fail_open is False

    def test_can_set_fail_open(self):
        from app.config import Settings

        s = Settings(
            _env_file=None,
            database_url="postgresql+asyncpg://test:test@localhost/test",
            turnstile_fail_open=True,
        )
        assert s.turnstile_fail_open is True
