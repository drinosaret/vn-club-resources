#!/usr/bin/env node
/**
 * Generate .git-dates.json with git commit dates for all guide files.
 * Run BEFORE Docker build since .git is excluded from the Docker context.
 *
 * Output format:
 * {
 *   "content/guides/guide.mdx": { "created": "2024-...", "updated": "2025-..." },
 *   ...
 * }
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const guidesDir = path.join(__dirname, '..', 'content', 'guides');
const outputFile = path.join(__dirname, '..', '.git-dates.json');

const dates = {};

try {
  const files = fs.readdirSync(guidesDir).filter(f => f.endsWith('.mdx'));

  for (const file of files) {
    const relPath = `content/guides/${file}`;
    try {
      // Get all commit dates for this file (follows renames)
      const log = execSync(`git log --follow -M10 --format=%aI -- "${relPath}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const lines = log.split('\n').filter(Boolean);

      if (lines.length > 0) {
        dates[relPath] = {
          updated: lines[0],              // newest commit
          created: lines[lines.length - 1] // oldest commit
        };
      }

      // Also check legacy paths for older history
      if (!dates[relPath] || !dates[relPath].created) {
        const basename = file.replace('.mdx', '.md');
        for (const legacyPath of [`docs/${basename}`, `legacy/docs/${basename}`]) {
          try {
            const legacyLog = execSync(`git log --follow -M10 --format=%aI -- "${legacyPath}"`, {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
            }).trim();
            const legacyLines = legacyLog.split('\n').filter(Boolean);
            if (legacyLines.length > 0) {
              dates[relPath] = dates[relPath] || {};
              dates[relPath].created = dates[relPath].created || legacyLines[legacyLines.length - 1];
              dates[relPath].updated = dates[relPath].updated || legacyLines[0];
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore individual file errors */ }
  }

  fs.writeFileSync(outputFile, JSON.stringify(dates, null, 2) + '\n');
  console.log(`Generated .git-dates.json with dates for ${Object.keys(dates).length} guides`);
} catch (err) {
  console.error('Failed to generate git dates:', err.message);
  process.exit(1);
}
