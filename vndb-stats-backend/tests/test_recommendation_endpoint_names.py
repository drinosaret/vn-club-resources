"""Every name a recommendations handler reads is a name it can resolve.

A handler reads its query parameters as locals, so a parameter that is used in the body
and not declared in the signature is a global lookup that fails only when the route is
called. The endpoints here are reached from one page and several of them are not covered
by a call-level test, so the check is made statically over the module's own handlers.
"""

import builtins
import dis
import inspect
import types

from fastapi import params

import app.api.v1.recommendations as api


def _global_reads(func) -> set[str]:
    """Names the function looks up in module scope, including inside its comprehensions."""
    names: set[str] = set()
    stack = [inspect.unwrap(func).__code__]
    while stack:
        code = stack.pop()
        names.update(
            instruction.argval
            for instruction in dis.get_instructions(code)
            if instruction.opname == "LOAD_GLOBAL"
        )
        stack.extend(
            const for const in code.co_consts if isinstance(const, types.CodeType)
        )
    return names


def _handlers() -> list:
    return [
        value
        for value in vars(api).values()
        if inspect.iscoroutinefunction(inspect.unwrap(value))
        and getattr(value, "__module__", "") == api.__name__
    ]


def test_every_handler_resolves_the_names_it_reads():
    assert _handlers(), "the module publishes handlers to check"
    unresolved = {}
    for handler in _handlers():
        missing = sorted(
            name
            for name in _global_reads(handler)
            if name not in vars(api) and not hasattr(builtins, name)
        )
        if missing:
            unresolved[handler.__name__] = missing
    assert unresolved == {}


def test_the_details_breakdown_takes_the_list_it_was_opened_from():
    # The breakdown is scored under the balance the card beside it was scored under, and a
    # single-signal list is a balance of its own.
    raw = inspect.unwrap(api.get_recommendation_details)
    parameter = inspect.signature(raw).parameters["list_name"]
    assert isinstance(parameter.default, params.Query)
    assert parameter.default.alias == "list"
    assert api.parse_list(parameter.default.default) is None
