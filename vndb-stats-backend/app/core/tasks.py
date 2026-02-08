"""Background task manager with error handling and tracking.

This module provides a centralized task manager for tracking and managing
background asyncio tasks with proper error handling, logging, and cleanup.
"""

import asyncio
import logging
from typing import Callable, Awaitable, Any
from weakref import WeakSet

logger = logging.getLogger(__name__)


class TaskManager:
    """
    Manage background tasks with error handling and tracking.

    This provides better visibility into background task failures compared
    to bare asyncio.create_task() calls which can silently fail.

    Usage:
        task_manager = TaskManager.get_instance()

        # Create a tracked task
        task = task_manager.create_task(
            some_coroutine(),
            name="my_task",
            on_error=handle_error
        )

        # On shutdown
        await task_manager.cancel_all()
    """

    _instance: "TaskManager | None" = None

    def __init__(self):
        self._tasks: WeakSet[asyncio.Task] = WeakSet()
        self._named_tasks: dict[str, asyncio.Task] = {}
        self._error_handlers: list[Callable[[str, Exception], Awaitable[None]]] = []

    @classmethod
    def get_instance(cls) -> "TaskManager":
        """Get the singleton TaskManager instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def reset_instance(cls) -> None:
        """Reset the singleton instance (for testing)."""
        cls._instance = None

    def create_task(
        self,
        coro: Awaitable[Any],
        name: str | None = None,
        on_error: Callable[[Exception], Awaitable[None]] | None = None,
    ) -> asyncio.Task:
        """
        Create a tracked background task with error handling.

        Args:
            coro: The coroutine to run
            name: Optional name for the task (for logging and retrieval)
            on_error: Optional async callback called if the task raises an exception

        Returns:
            The created asyncio.Task
        """

        async def wrapped_coro():
            task_name = name or "unnamed"
            try:
                logger.debug(f"Starting background task: {task_name}")
                result = await coro
                logger.debug(f"Background task completed: {task_name}")
                return result
            except asyncio.CancelledError:
                logger.info(f"Background task cancelled: {task_name}")
                raise
            except Exception as e:
                logger.error(f"Background task failed: {task_name} - {type(e).__name__}: {e}")

                # Call task-specific error handler
                if on_error:
                    try:
                        await on_error(e)
                    except Exception as handler_error:
                        logger.error(
                            f"Error handler failed for {task_name}: {handler_error}"
                        )

                # Call global error handlers
                for handler in self._error_handlers:
                    try:
                        await handler(task_name, e)
                    except Exception as handler_error:
                        logger.error(f"Global error handler failed: {handler_error}")

                # Re-raise to mark task as failed
                raise

        task = asyncio.create_task(wrapped_coro(), name=name)
        self._tasks.add(task)

        if name:
            # If a task with this name exists and is done, replace it
            existing = self._named_tasks.get(name)
            if existing and existing.done():
                del self._named_tasks[name]
            self._named_tasks[name] = task

        return task

    def get_task(self, name: str) -> asyncio.Task | None:
        """Get a named task by name."""
        task = self._named_tasks.get(name)
        if task and task.done():
            del self._named_tasks[name]
            return None
        return task

    def add_global_error_handler(
        self, handler: Callable[[str, Exception], Awaitable[None]]
    ) -> None:
        """
        Add a global error handler called for any task failure.

        The handler receives (task_name, exception) arguments.
        """
        self._error_handlers.append(handler)

    def get_running_tasks(self) -> list[asyncio.Task]:
        """Get all currently running (non-done) tasks."""
        return [t for t in self._tasks if not t.done()]

    def get_task_stats(self) -> dict:
        """Get statistics about tracked tasks."""
        all_tasks = list(self._tasks)
        running = [t for t in all_tasks if not t.done()]
        done = [t for t in all_tasks if t.done()]
        failed = [t for t in done if not t.cancelled() and t.exception() is not None]
        cancelled = [t for t in done if t.cancelled()]

        return {
            "total_tracked": len(all_tasks),
            "running": len(running),
            "completed": len(done) - len(failed) - len(cancelled),
            "failed": len(failed),
            "cancelled": len(cancelled),
            "named_tasks": list(self._named_tasks.keys()),
        }

    async def cancel_all(self, timeout: float = 5.0) -> dict:
        """
        Cancel all tracked tasks and wait for them to finish.

        Args:
            timeout: Maximum time to wait for tasks to finish

        Returns:
            Statistics about cancelled tasks
        """
        running = self.get_running_tasks()
        if not running:
            return {"cancelled": 0, "timed_out": 0}

        logger.info(f"Cancelling {len(running)} background tasks...")

        # Cancel all running tasks
        for task in running:
            task.cancel()

        # Wait for them to finish
        done, pending = await asyncio.wait(
            running,
            timeout=timeout,
            return_when=asyncio.ALL_COMPLETED,
        )

        timed_out = len(pending)
        if timed_out > 0:
            logger.warning(
                f"{timed_out} tasks did not finish within {timeout}s timeout"
            )

        return {
            "cancelled": len(done),
            "timed_out": timed_out,
        }

    async def wait_for_task(
        self, name: str, timeout: float | None = None
    ) -> Any | None:
        """
        Wait for a named task to complete.

        Args:
            name: The task name
            timeout: Optional timeout in seconds

        Returns:
            The task result, or None if task not found

        Raises:
            asyncio.TimeoutError: If timeout exceeded
            Exception: If the task raised an exception
        """
        task = self.get_task(name)
        if task is None:
            return None

        if timeout:
            return await asyncio.wait_for(task, timeout=timeout)
        return await task
