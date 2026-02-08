"""Correlation ID middleware for request tracing."""

import uuid
from contextvars import ContextVar
from typing import Optional

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

# Thread-safe context variable for correlation ID
# This allows the correlation ID to be accessed from anywhere in the request context
correlation_id_var: ContextVar[str] = ContextVar("correlation_id", default="")


def get_correlation_id() -> str:
    """
    Get the current correlation ID from context.

    Returns empty string if called outside of a request context.
    """
    return correlation_id_var.get()


def generate_correlation_id() -> str:
    """Generate a short unique correlation ID."""
    return str(uuid.uuid4())[:16]


class CorrelationIDMiddleware(BaseHTTPMiddleware):
    """
    Middleware that extracts or generates a correlation ID for each request.

    The correlation ID is:
    - Extracted from the X-Correlation-ID header if present
    - Generated if not present
    - Added to the response headers
    - Made available via get_correlation_id() for logging
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        # Get correlation ID from header or generate new one
        correlation_id = request.headers.get("X-Correlation-ID")
        if not correlation_id:
            correlation_id = generate_correlation_id()

        # Set in context for this request
        token = correlation_id_var.set(correlation_id)

        try:
            response = await call_next(request)
            # Add to response headers for client tracing
            response.headers["X-Correlation-ID"] = correlation_id
            return response
        finally:
            # Reset context to prevent leaking between requests
            correlation_id_var.reset(token)
