import { execSync } from 'child_process';
import path from 'path';

export interface GitDates {
  created?: string;
  updated?: string;
}

// Cache git dates to avoid repeated git command execution
const gitDatesCache = new Map<string, GitDates>();

function getGitLastCommitDate(gitPath: string): string | undefined {
  try {
    const result = execSync(
      `git log --follow --format=%aI -1 -- "${gitPath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd: process.cwd() }
    ).trim();
    return result || undefined;
  } catch {
    return undefined;
  }
}

function getGitFirstCommitDate(gitPath: string): string | undefined {
  try {
    const result = execSync(
      `git log --follow --format=%aI -- "${gitPath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd: process.cwd() }
    ).trim();
    // Get the last line (oldest commit)
    const lines = result.split('\n').filter(Boolean);
    return lines[lines.length - 1] || undefined;
  } catch {
    return undefined;
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

    // Try the current file path first
    let createdDate = getGitFirstCommitDate(gitPath);
    let updatedDate = getGitLastCommitDate(gitPath);

    // If no history found, try the original docs path
    // content/guides/guide.mdx -> docs/guide.md
    if ((!createdDate || !updatedDate) && gitPath.includes('content/guides/')) {
      const filename = path.basename(gitPath, '.mdx') + '.md';
      // Try original docs/ path first (works before commit)
      if (!createdDate) {
        createdDate = getGitFirstCommitDate(`docs/${filename}`);
      }
      if (!updatedDate) {
        updatedDate = getGitLastCommitDate(`docs/${filename}`);
      }
      // After commit, try legacy/docs/ path
      if (!createdDate) {
        createdDate = getGitFirstCommitDate(`legacy/docs/${filename}`);
      }
      if (!updatedDate) {
        updatedDate = getGitLastCommitDate(`legacy/docs/${filename}`);
      }
    }

    const dates = {
      created: createdDate,
      updated: updatedDate,
    };

    // Cache the result
    gitDatesCache.set(filePath, dates);

    return dates;
  } catch (error) {
    console.error('Git dates error:', error);
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