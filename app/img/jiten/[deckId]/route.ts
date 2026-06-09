import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

// Clean URL for the jiten SFW cover
// (see lib/safe-cover.ts). Downloads cdn.jiten.moe/{deckId}/cover.jpg, converts to
// WebP, and disk-caches it under the same dir as the VNDB covers so it shares the
// /img/ cache header and (in prod) nginx's static serving.

const WEBP_QUALITY = 80;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

// Same cache root as the VNDB /img/ route, so the path-to-file mapping lines up.
function cacheFile(deckId: string): string {
  const dir = process.env.VNDB_CACHE_DIR
    ? path.resolve(process.env.VNDB_CACHE_DIR)
    : path.join(os.homedir(), '.vnclub', 'vndb-cache');
  return path.join(dir, 'jiten', `${deckId}.webp`);
}

// Share one outbound fetch across concurrent requests for the same deck.
const inflight = new Map<string, Promise<Buffer | null>>();

async function fetchAndCache(deckId: string, dest: string, clientIp: string): Promise<Buffer | null> {
  // Throttle only outbound fetches; cache hits never reach here.
  if (!checkRateLimit(`jiten-cover:${clientIp}`, RATE_LIMITS.imageProxy).allowed) return null;
  const existing = inflight.get(deckId);
  if (existing) return existing;
  const job = (async () => {
    try {
      const res = await fetch(`https://cdn.jiten.moe/${deckId}/cover.jpg`, {
        headers: { 'User-Agent': 'VN-Club-Resources/1.0 (image caching)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const ct = res.headers.get('content-type');
      if (!ct || !ct.startsWith('image/')) return null;
      const cl = res.headers.get('content-length');
      if (cl && parseInt(cl, 10) > MAX_IMAGE_SIZE_BYTES) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_IMAGE_SIZE_BYTES) return null;
      const webp = await sharp(buf).webp({ quality: WEBP_QUALITY }).toBuffer();
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, webp);
      return webp;
    } catch {
      return null;
    }
  })();
  inflight.set(deckId, job);
  try {
    return await job;
  } finally {
    inflight.delete(deckId);
  }
}

function serve(buf: Buffer, immutable: boolean): NextResponse {
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'image/webp',
      'Content-Disposition': 'inline',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const { deckId: raw } = await params;
  const m = raw.match(/^(\d+)\.webp$/);
  if (!m) return NextResponse.json({ error: 'Invalid deck id' }, { status: 400 });
  const deckId = m[1];
  const dest = cacheFile(deckId);

  let cached: Buffer | null = null;
  let stale = true;
  try {
    cached = await fs.readFile(dest);
    stale = Date.now() - (await fs.stat(dest)).mtimeMs > MAX_AGE_MS;
  } catch {
    // cache miss
  }
  if (cached && !stale) return serve(cached, true);

  const fresh = await fetchAndCache(deckId, dest, getClientIp(request));
  if (fresh) return serve(fresh, true);
  if (cached) return serve(cached, false); // stale fallback when the fetch fails
  return NextResponse.json({ error: 'Cover not available' }, { status: 502 });
}
