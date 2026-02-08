/**
 * DOM utility functions for consistent timing and layout operations.
 */

/**
 * Execute callback after React render and browser layout are complete.
 * Uses triple requestAnimationFrame to ensure DOM is fully stable.
 * This is useful for scroll restoration after navigation when content
 * may still be rendering.
 */
export function afterLayout(callback: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(callback);
    });
  });
}

/**
 * Execute callback in next frame (single rAF).
 * Use for immediate post-render work that doesn't require full layout stability.
 */
export function nextFrame(callback: () => void): void {
  requestAnimationFrame(callback);
}

/**
 * Execute callback after a specified number of animation frames.
 * @param frames - Number of frames to wait (default: 1)
 * @param callback - Function to execute
 */
export function afterFrames(frames: number, callback: () => void): void {
  if (frames <= 0) {
    callback();
    return;
  }
  requestAnimationFrame(() => afterFrames(frames - 1, callback));
}
