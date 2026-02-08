#!/usr/bin/env node
/**
 * Development startup script
 * Automatically starts Docker containers and imports data if needed
 */

const { spawn, exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BACKEND_DIR = path.join(__dirname, '..', 'vndb-stats-backend');

// Load backend .env file for Discord bot token check
const backendEnvPath = path.join(BACKEND_DIR, '.env');
if (fs.existsSync(backendEnvPath)) {
  const envContent = fs.readFileSync(backendEnvPath, 'utf-8');
  envContent.split('\n').forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  });
}
const API_URL = 'http://localhost:8000';

function log(msg) {
  console.log(`\x1b[36m[startup]\x1b[0m ${msg}`);
}

function logError(msg) {
  console.log(`\x1b[31m[startup]\x1b[0m ${msg}`);
}

function logSuccess(msg) {
  console.log(`\x1b[32m[startup]\x1b[0m ${msg}`);
}

function isDockerRunning() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function areContainersRunning() {
  try {
    const result = execSync('docker compose ps --status running -q', {
      cwd: BACKEND_DIR,
      encoding: 'utf-8',
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

async function waitForApi(maxAttempts = 30) {
  log('Waiting for API to be ready...');
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${API_URL}/health`);
      if (response.ok) {
        logSuccess('API is ready!');
        return true;
      }
    } catch {
      // API not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function isDatabasePopulated() {
  try {
    const response = await fetch(`${API_URL}/health/db`);
    if (response.ok) {
      const data = await response.json();
      return data.has_data === true;
    }
  } catch {
    // Ignore
  }
  return false;
}

function startContainers() {
  log('Starting Docker containers...');
  try {
    execSync('docker compose up -d', {
      cwd: BACKEND_DIR,
      stdio: 'inherit',
    });
    return true;
  } catch (e) {
    logError('Failed to start containers');
    return false;
  }
}

function runImport() {
  log('Database is empty. Running initial import (this may take a few minutes)...');
  try {
    execSync('docker compose exec -T api python scripts/initial_import.py', {
      cwd: BACKEND_DIR,
      stdio: 'inherit',
    });
    logSuccess('Import completed!');
    return true;
  } catch (e) {
    logError('Import failed. You can run it manually later with: npm run api:import');
    return false;
  }
}

function openBackendLogs() {
  log('Opening backend logs in new terminal...');
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    // Open a new Windows terminal with Docker logs
    exec('start cmd /k "docker logs -f vndb-stats-backend-api-1"');
  } else {
    // macOS/Linux - try to open in new terminal
    const terminal = process.platform === 'darwin'
      ? ['open', ['-a', 'Terminal', '--args', 'docker', 'logs', '-f', 'vndb-stats-backend-api-1']]
      : ['gnome-terminal', ['--', 'docker', 'logs', '-f', 'vndb-stats-backend-api-1']];

    spawn(terminal[0], terminal[1], {
      stdio: 'ignore',
      detached: true,
    });
  }
}

function startDiscordBot() {
  // Check if DISCORD_BOT_TOKEN is set
  if (!process.env.DISCORD_BOT_TOKEN) {
    log('DISCORD_BOT_TOKEN not set, skipping Discord bot');
    return null;
  }

  log('Starting Discord bot...');
  const isWindows = process.platform === 'win32';
  const pythonCmd = isWindows ? 'python' : 'python3';

  const bot = spawn(pythonCmd, ['scripts/run_bot.py'], {
    cwd: BACKEND_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  bot.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      console.log(`\x1b[35m[discord]\x1b[0m ${line}`);
    });
  });

  bot.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      console.log(`\x1b[35m[discord]\x1b[0m ${line}`);
    });
  });

  bot.on('close', (code) => {
    if (code !== 0 && code !== null) {
      logError(`Discord bot exited with code ${code}`);
    }
  });

  return bot;
}

function startDevServers() {
  log('Starting development servers...');

  // Open backend logs in separate terminal
  openBackendLogs();

  // Start Discord bot if configured
  const bot = startDiscordBot();

  const next = spawn('npx next dev --turbo', [], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    shell: true,
  });

  next.on('close', (code) => {
    if (bot) bot.kill();
    process.exit(code);
  });

  process.on('SIGINT', () => {
    if (bot) bot.kill();
    next.kill('SIGINT');
  });
}

async function main() {
  console.log('\n');
  log('Starting VN Club development environment...\n');

  // Check Docker
  if (!isDockerRunning()) {
    logError('Docker is not running!');
    logError('Please start Docker Desktop and try again.');
    process.exit(1);
  }

  // Start containers if not running
  if (!areContainersRunning()) {
    if (!startContainers()) {
      process.exit(1);
    }
  } else {
    log('Docker containers already running');
  }

  // Wait for API
  const apiReady = await waitForApi();
  if (!apiReady) {
    logError('API failed to start. Check Docker logs with: docker compose logs -f');
    process.exit(1);
  }

  // Check if data needs to be imported
  const hasData = await isDatabasePopulated();
  if (!hasData) {
    runImport();
  } else {
    log('Database already has data');
  }

  console.log('\n');
  logSuccess('Backend is ready at http://localhost:8000');
  logSuccess('Starting Next.js...\n');

  // Start Next.js
  startDevServers();
}

main().catch((e) => {
  logError(e.message);
  process.exit(1);
});
