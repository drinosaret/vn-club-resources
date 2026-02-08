import { execSync } from 'child_process';
import path from 'path';

export interface GitDates {
  created?: string;
  updated?: string;
}

// Cache git dates to avoid repeated git command execution
const gitDatesCache = new Map<string, GitDates>();

/**
 * Get both first and last commit dates for a file in a single git call.
 * --follow tracks renames so dates survive file moves.
 */
function getGitDatesForPath(gitPath: string): GitDates {
  try {
    const result = execSync(
      `git log --follow -M10 --format=%aI -- "${gitPath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd: process.cwd() }
    ).trim();
    const lines = result.split('\n').filter(Boolean);
    if (lines.length === 0) return {};
    return {
      updated: lines[0],               // newest commit = first line
      created: lines[lines.length - 1], // oldest commit = last line
    };
  } catch {
    return {};
  }
}

export function getGitDates(filePath: string): GitDates {
  // Check cache first
  if (gitDatesCache.has(filePath)) {
    return gitDatesCache.get(filePath)!;
  }

  try {
    // Normalize path for git (use forward slashes, relative to repo root)
    const gitPath = filePath.replace(/\\/g, '/');

    // Try the current file path first (single git call for both dates)
    let dates = getGitDatesForPath(gitPath);

    // If no history found, try the original docs path
    // content/guides/guide.mdx -> docs/guide.md
    if ((!dates.created || !dates.updated) && gitPath.includes('content/guides/')) {
      const filename = path.basename(gitPath, '.mdx') + '.md';
      // Try original docs/ path first
      if (!dates.created || !dates.updated) {
        const fallback = getGitDatesForPath(`docs/${filename}`);
        dates = {
          created: dates.created || fallback.created,
          updated: dates.updated || fallback.updated,
        };
      }
      // After commit, try legacy/docs/ path
      if (!dates.created || !dates.updated) {
        const fallback = getGitDatesForPath(`legacy/docs/${filename}`);
        dates = {
          created: dates.created || fallback.created,
          updated: dates.updated || fallback.updated,
        };
      }
    }

    // Cache the result
    gitDatesCache.set(filePath, dates);
    return dates;
  } catch {
    // Return empty if git commands fail (e.g., not in a git repo)
    const emptyDates = {};
    gitDatesCache.set(filePath, emptyDates);
    return emptyDates;
  }
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}
