"""Retry utilities with exponential backoff for resilient async operations.

This module provides decorators and utilities for retrying failed async operations
with configurable exponential backoff, jitter, and exception filtering.
"""

import asyncio
import functools
import logging
import random
from dataclasses import dataclass, field
from typing import Callable, TypeVar, Any

import httpx

logger = logging.getLogger(__name__)

T = TypeVar("T")


@dataclass
class RetryConfig:
    """Configuration for retry behavior."""

    max_attempts: int = 3
    base_delay: float = 1.0  # Initial delay in seconds
    max_delay: float = 60.0  # Maximum delay between retries
    exponential_base: float = 2.0  # Multiplier for exponential backoff
    jitter: float = 0.1  # Random jitter factor (0.1 = +/- 10%)
    retryable_exceptions: tuple = field(
        default_factory=lambda: (
            httpx.TimeoutException,
            httpx.NetworkError,
            ConnectionError,
            asyncio.TimeoutError,
        )
    )
    # For HTTP errors, only retry on these status codes (5xx by default)
    retryable_status_codes: tuple = field(
        default_factory=lambda: (500, 502, 503, 504, 520, 521, 522, 523, 524)
    )


def calculate_delay(attempt: int, config: RetryConfig) -> float:
    """Calculate delay with exponential backoff and jitter."""
    # Exponential backoff: base_delay * (exponential_base ^ attempt)
    delay = config.base_delay * (config.exponential_base ** attempt)

    # Cap at max_delay
    delay = min(delay, config.max_delay)

    # Add jitter to prevent thundering herd
    jitter_range = delay * config.jitter
    delay = delay + random.uniform(-jitter_range, jitter_range)

    return max(0, delay)  # Ensure non-negative


def is_retryable_exception(exc: Exception, config: RetryConfig) -> bool:
    """Check if an exception should trigger a retry."""
    # Check if it's a directly retryable exception type
    if isinstance(exc, config.retryable_exceptions):
        return True

    # Special handling for HTTP status errors
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in config.retryable_status_codes

    return False


def async_retry(config: RetryConfig | None = None):
    """
    Decorator for retrying async functions with exponential backoff.

    Usage:
        @async_retry(RetryConfig(max_attempts=3))
        async def fetch_data():
            ...

        # Or with default config:
        @async_retry()
        async def fetch_data():
            ...
    """
    if config is None:
        config = RetryConfig()

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs) -> T:
            last_exception: Exception | None = None

            for attempt in range(config.max_attempts):
                try:
                    return await func(*args, **kwargs)
                except Exception as e:
                    last_exception = e

                    if not is_retryable_exception(e, config):
                        # Non-retryable exception, raise immediately
                        raise

                    if attempt < config.max_attempts - 1:
                        delay = calculate_delay(attempt, config)
                        logger.warning(
                            f"Retry {attempt + 1}/{config.max_attempts} for {func.__name__} "
                            f"after {type(e).__name__}: {e}. Waiting {delay:.2f}s"
                        )
                        await asyncio.sleep(delay)
                    else:
                        logger.error(
                            f"All {config.max_attempts} attempts failed for {func.__name__}: {e}"
                        )

            # All retries exhausted
            raise last_exception

        return wrapper

    return decorator


async def retry_async(
    func: Callable[..., T],
    *args,
    config: RetryConfig | None = None,
    **kwargs,
) -> T:
    """
    Retry an async function call with exponential backoff.

    This is a non-decorator version for cases where you need to retry
    a function call inline.

    Usage:
        result = await retry_async(fetch_data, url, config=RetryConfig(max_attempts=5))
    """
    if config is None:
        config = RetryConfig()

    last_exception: Exception | None = None

    for attempt in range(config.max_attempts):
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            last_exception = e

            if not is_retryable_exception(e, config):
                raise

            if attempt < config.max_attempts - 1:
                delay = calculate_delay(attempt, config)
                logger.warning(
                    f"Retry {attempt + 1}/{config.max_attempts} for {func.__name__} "
                    f"after {type(e).__name__}: {e}. Waiting {delay:.2f}s"
                )
                await asyncio.sleep(delay)
            else:
                logger.error(
                    f"All {config.max_attempts} attempts failed for {func.__name__}: {e}"
                )

    raise last_exception


class RetryContext:
    """
    Context manager for retry logic in more complex scenarios.

    Usage:
        async with RetryContext(config) as ctx:
            while ctx.should_retry():
                try:
                    result = await some_operation()
                    break
                except Exception as e:
                    await ctx.handle_exception(e)
    """

    def __init__(self, config: RetryConfig | None = None):
        self.config = config or RetryConfig()
        self.attempt = 0
        self.last_exception: Exception | None = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        pass

    def should_retry(self) -> bool:
        """Check if another retry attempt should be made."""
        return self.attempt < self.config.max_attempts

    async def handle_exception(self, exc: Exception) -> None:
        """Handle an exception, waiting if retry is appropriate."""
        self.last_exception = exc
        self.attempt += 1

        if not is_retryable_exception(exc, self.config):
            raise exc

        if self.attempt >= self.config.max_attempts:
            logger.error(f"All {self.config.max_attempts} attempts exhausted: {exc}")
            raise exc

        delay = calculate_delay(self.attempt - 1, self.config)
        logger.warning(
            f"Retry {self.attempt}/{self.config.max_attempts} "
            f"after {type(exc).__name__}: {exc}. Waiting {delay:.2f}s"
        )
        await asyncio.sleep(delay)
