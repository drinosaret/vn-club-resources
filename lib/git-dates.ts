import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface GitDates {
  created?: string;
  updated?: string;
}

// Cache git dates to avoid repeated git command execution
const gitDatesCache = new Map<string, GitDates>();

// Pre-generated dates from .git-dates.json (used in Docker where .git is unavailable)
// undefined = not loaded yet, null = loaded but file missing/failed
let preGeneratedDates: Record<string, GitDates> | null | undefined;

function loadPreGeneratedDates(): Record<string, GitDates> | null {
  if (preGeneratedDates !== undefined) return preGeneratedDates;
  try {
    const jsonPath = path.join(process.cwd(), '.git-dates.json');
    const data = fs.readFileSync(jsonPath, 'utf-8');
    const parsed: Record<string, GitDates> = JSON.parse(data);
    preGeneratedDates = parsed;
    return parsed;
  } catch {
    preGeneratedDates = null;
    return null;
  }
}

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

    // If git commands returned nothing, fall back to pre-generated .git-dates.json
    // This handles Docker builds where .git is excluded
    if (!dates.created && !dates.updated) {
      const preGenerated = loadPreGeneratedDates();
      if (preGenerated) {
        // Try the normalized gitPath as key (e.g. "content/guides/guide.mdx")
        const key = gitPath.replace(/^.*?(content\/guides\/)/, '$1');
        if (preGenerated[key]) {
          dates = preGenerated[key];
        }
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
