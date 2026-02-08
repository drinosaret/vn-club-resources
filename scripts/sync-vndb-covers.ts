/**
 * VNDB Cover Sync Script
 *
 * Syncs all VNDB cover images via rsync and converts them to WebP.
 * Run weekly via cron/scheduler or manually before deployment.
 *
 * First run will download ~9GB of images.
 * Subsequent runs only download new/changed images.
 *
 * Usage: npx tsx scripts/sync-vndb-covers.ts [--convert-only] [--skip-sync]
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

// Cache dir priority: VNDB_CACHE_DIR env > static export public/ > ~/.vnclub/vndb-cache
function resolveCacheDir(): string {
  if (process.env.VNDB_CACHE_DIR) return path.resolve(process.env.VNDB_CACHE_DIR);
  if (process.env.STATIC_EXPORT === 'true') return path.join(process.cwd(), 'public/cache/vndb');
  return path.join(os.homedir(), '.vnclub', 'vndb-cache');
}
const CACHE_DIR = resolveCacheDir();
const CV_DIR = path.join(CACHE_DIR, 'cv');
const WEBP_QUALITY = 80;
const CONCURRENT_CONVERSIONS = 10;
const VARIANT_WIDTHS = [256, 512] as const;
const IS_WINDOWS = process.platform === 'win32';

/**
 * Convert Windows path to WSL path
 * e.g., C:\Users\foo\bar -> /mnt/c/Users/foo/bar
 */
function toWslPath(windowsPath: string): string {
  // Replace backslashes with forward slashes
  let wslPath = windowsPath.replace(/\\/g, '/');
  // Convert drive letter (e.g., C: -> /mnt/c)
  wslPath = wslPath.replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`);
  return wslPath;
}

/**
 * Check if rsync is available (native or via WSL)
 */
function checkRsync(): boolean {
  try {
    if (IS_WINDOWS) {
      execSync('wsl which rsync', { stdio: 'ignore' });
    } else {
      execSync('rsync --version', { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Sync covers from VNDB via rsync
 */
async function syncCovers(): Promise<void> {
  console.log('Syncing covers from VNDB (this may take a while on first run)...');
  console.log(`Target directory: ${CV_DIR}`);

  // Ensure directory exists
  if (!fs.existsSync(CV_DIR)) {
    fs.mkdirSync(CV_DIR, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    // On Windows, use WSL to run rsync
    const targetPath = IS_WINDOWS ? toWslPath(CV_DIR) : CV_DIR;
    const command = IS_WINDOWS ? 'wsl' : 'rsync';
    const args = IS_WINDOWS
      ? [
          'rsync',
          '-rtpv',
          '--progress',
          '--del',
          '--exclude=*.webp',
          'rsync://dl.vndb.org/vndb-img/cv/',
          targetPath + '/',
        ]
      : [
          '-rtpv',
          '--progress',
          '--del',
          '--exclude=*.webp',
          'rsync://dl.vndb.org/vndb-img/cv/',
          CV_DIR + '/',
        ];

    console.log(`Running: ${command} ${args.join(' ')}`);

    const rsync = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let lastLine = '';
    rsync.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      if (lines.length > 0) {
        lastLine = lines[lines.length - 1];
        // Only print progress lines periodically
        if (lastLine.includes('%') || lines.some((l: string) => l.endsWith('.jpg'))) {
          process.stdout.write(`\r${lastLine.slice(0, 80).padEnd(80)}`);
        }
      }
    });

    rsync.stderr.on('data', (data) => {
      console.error(`\nrsync error: ${data}`);
    });

    rsync.on('close', (code) => {
      console.log('\n');
      // Exit code 0 = success
      // Exit code 23 = partial transfer (some files/attrs not transferred, but bulk succeeded)
      // Exit code 24 = partial transfer due to vanished source files (files deleted during sync)
      // These are acceptable for our use case - the important cover images are transferred
      if (code === 0) {
        console.log('Rsync completed successfully!');
        resolve();
      } else if (code === 23 || code === 24) {
        console.log(`Rsync completed with warnings (exit code ${code}).`);
        console.log('This is normal - some files may have been skipped, but the sync is complete.');
        resolve();
      } else {
        reject(new Error(`Rsync failed with code ${code}`));
      }
    });
  });
}

/**
 * Find all JPG files that don't have a WebP version
 */
function findUnconvertedImages(): string[] {
  const unconverted: string[] = [];

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith('.jpg')) {
        const webpPath = fullPath.replace('.jpg', '.webp');
        if (!fs.existsSync(webpPath)) {
          unconverted.push(fullPath);
        }
      }
    }
  }

  scanDir(CV_DIR);
  return unconverted;
}

/**
 * Convert a single image to WebP with retry
 */
async function convertToWebP(jpgPath: string, retries = 2): Promise<boolean> {
  const webpPath = jpgPath.replace('.jpg', '.webp');

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await sharp(jpgPath)
        .webp({ quality: WEBP_QUALITY })
        .toFile(webpPath);
      return true;
    } catch (error) {
      if (attempt < retries) {
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      // Log error on final failure but don't crash
      return false;
    }
  }
  return false;
}

/**
 * Convert images in parallel with concurrency limit
 */
async function convertImagesInParallel(images: string[]): Promise<{ converted: number; failed: number }> {
  const results = { converted: 0, failed: 0 };
  const queue = [...images];
  let processed = 0;

  async function worker() {
    while (queue.length > 0) {
      const imagePath = queue.shift();
      if (!imagePath) break;

      const success = await convertToWebP(imagePath);
      if (success) {
        results.converted++;
      } else {
        results.failed++;
      }

      processed++;
      if (processed % 100 === 0) {
        process.stdout.write(`\rConverted ${processed}/${images.length} images...`);
      }
    }
  }

  const workers = Array(CONCURRENT_CONVERSIONS).fill(null).map(() => worker());
  await Promise.all(workers);

  console.log(`\rConverted ${processed}/${images.length} images.`);
  return results;
}

/**
 * Find JPG files that need resized variants (w256, w512) generated.
 * Skips variants that already exist and are newer than the source JPG.
 */
interface VariantTask {
  jpgPath: string;
  variants: { width: number; outputPath: string }[];
}

function findMissingVariants(): VariantTask[] {
  const tasks: VariantTask[] = [];

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith('.jpg')) {
        const baseName = entry.name.replace('.jpg', '');
        const jpgMtime = fs.statSync(fullPath).mtimeMs;
        const missingVariants: { width: number; outputPath: string }[] = [];

        for (const width of VARIANT_WIDTHS) {
          const variantPath = path.join(dir, `${baseName}-w${width}.webp`);
          let needsGeneration = true;

          if (fs.existsSync(variantPath)) {
            const variantMtime = fs.statSync(variantPath).mtimeMs;
            if (variantMtime >= jpgMtime) {
              needsGeneration = false;
            }
          }

          if (needsGeneration) {
            missingVariants.push({ width, outputPath: variantPath });
          }
        }

        if (missingVariants.length > 0) {
          tasks.push({ jpgPath: fullPath, variants: missingVariants });
        }
      }
    }
  }

  scanDir(CV_DIR);
  return tasks;
}

/**
 * Generate resized variants for a single source image.
 * Reads the source once and produces all requested widths.
 */
async function generateVariants(task: VariantTask, retries = 2): Promise<{ generated: number; failed: number }> {
  const results = { generated: 0, failed: 0 };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const sourceBuffer = fs.readFileSync(task.jpgPath);

      for (const variant of task.variants) {
        try {
          await sharp(sourceBuffer)
            .resize(variant.width, null, {
              fit: 'inside',
              withoutEnlargement: true,
            })
            .webp({ quality: WEBP_QUALITY })
            .toFile(variant.outputPath);
          results.generated++;
        } catch {
          results.failed++;
        }
      }
      return results;
    } catch {
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      results.failed += task.variants.length;
      return results;
    }
  }
  return results;
}

/**
 * Generate resized variants in parallel with concurrency limit
 */
async function generateVariantsInParallel(tasks: VariantTask[]): Promise<{ generated: number; failed: number }> {
  const results = { generated: 0, failed: 0 };
  const queue = [...tasks];
  let processed = 0;
  const totalVariants = tasks.reduce((sum, t) => sum + t.variants.length, 0);

  async function worker() {
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) break;

      const taskResults = await generateVariants(task);
      results.generated += taskResults.generated;
      results.failed += taskResults.failed;

      processed++;
      if (processed % 100 === 0) {
        process.stdout.write(`\rGenerated ${results.generated + results.failed}/${totalVariants} resized variants...`);
      }
    }
  }

  const workers = Array(CONCURRENT_CONVERSIONS).fill(null).map(() => worker());
  await Promise.all(workers);

  console.log(`\rGenerated ${results.generated + results.failed}/${totalVariants} resized variants.`);
  return results;
}

/**
 * Parse command line arguments
 */
function parseArgs(): { convertOnly: boolean; skipSync: boolean } {
  const args = process.argv.slice(2);
  return {
    convertOnly: args.includes('--convert-only'),
    skipSync: args.includes('--skip-sync'),
  };
}

/**
 * Main function
 */
async function main() {
  const args = parseArgs();

  console.log('VNDB Cover Sync');
  console.log('===============\n');

  // Check for rsync
  if (!args.convertOnly && !args.skipSync) {
    if (!checkRsync()) {
      console.error('Error: rsync is not installed or not in PATH.');
      console.error('On Windows, install via WSL or use --skip-sync to only convert existing images.');
      process.exit(1);
    }

    // Sync covers from VNDB
    await syncCovers();
  } else if (args.skipSync) {
    console.log('Skipping rsync (--skip-sync flag)');
  }

  // Phase 2: Convert new JPGs to full-size WebP
  console.log('\nPhase 2: Scanning for unconverted images...');
  const unconverted = findUnconvertedImages();
  console.log(`Found ${unconverted.length} images to convert to WebP`);

  if (unconverted.length > 0) {
    console.log('\nConverting to WebP...');
    const results = await convertImagesInParallel(unconverted);
    console.log(`\nConversion complete!`);
    console.log(`  Converted: ${results.converted}`);
    console.log(`  Failed: ${results.failed}`);
  }

  // Phase 3: Generate resized variants (w256, w512)
  console.log('\nPhase 3: Scanning for missing resized variants...');
  const variantTasks = findMissingVariants();
  const totalVariants = variantTasks.reduce((sum, t) => sum + t.variants.length, 0);
  console.log(`Found ${variantTasks.length} images needing ${totalVariants} resized variants`);

  if (variantTasks.length > 0) {
    console.log('\nGenerating resized variants (w256, w512)...');
    const variantResults = await generateVariantsInParallel(variantTasks);
    console.log(`\nVariant generation complete!`);
    console.log(`  Generated: ${variantResults.generated}`);
    console.log(`  Failed: ${variantResults.failed}`);
  }

  console.log('\nSync complete!');
  console.log(`Cache directory: ${CACHE_DIR}`);
}

main().catch((error) => {
  console.error('Error:', error);
  // Only exit with error for critical failures (rsync completely failed)
  // Don't fail the entire process for partial conversion failures
  if (error.message?.includes('Rsync failed')) {
    process.exit(1);
  }
  // For other errors, log but exit cleanly
  console.log('Sync completed with some errors.');
  process.exit(0);
});
