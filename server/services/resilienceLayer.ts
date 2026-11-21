import zlib from 'node:zlib';
import { NextFunction, Request, Response } from 'express';

export type CacheLookupStatus = 'HIT' | 'COALESCED' | 'MISS';

interface CacheEntry<T> {
  epoch: number;
  value: T;
  expiresAt: number;
  createdAt: number;
}

export interface CacheStatsSnapshot {
  entries: number;
  maxEntries: number;
  inFlight: number;
  hits: number;
  misses: number;
  coalescedHits: number;
  evictions: number;
  hitRatePct: number;
  lastEpoch: number;
}

/**
 * Epoch-versioned Bounded LRU Cache with Single-Flight Request Coalescing.
 *
 * - Eliminates thundering-herd OLAP spikes: if 100 users request the same dashboard
 *   or econometric model concurrently, DuckDB computes it ONCE and all 100 callers
 *   await the exact same in-flight promise.
 * - Instant consistency: tied strictly to DuckDB's monotonic `warehouseEpoch`. Any
 *   data mutation (CSV upload, seed, clear, SQL remediation) bumps the epoch and
 *   immediately invalidates prior entries with zero stale reads.
 */
export class SingleFlightLruCache {
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private lastEpoch = 0;

  private hits = 0;
  private misses = 0;
  private coalescedHits = 0;
  private evictions = 0;

  constructor(options?: { maxEntries?: number; defaultTtlMs?: number }) {
    this.maxEntries = Math.max(16, options?.maxEntries ?? 180);
    this.defaultTtlMs = Math.max(5_000, options?.defaultTtlMs ?? 300_000);
  }

  public clear(): void {
    this.store.clear();
    this.inFlight.clear();
  }

  private evictIfNeeded(): void {
    while (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
      this.evictions++;
    }
  }

  public async getOrCompute<T>(
    epoch: number,
    key: string,
    factory: () => Promise<T>,
    ttlMs?: number
  ): Promise<{ value: T; cacheStatus: CacheLookupStatus }> {
    // Fast epoch sweep when warehouse data mutates
    if (epoch !== this.lastEpoch) {
      this.store.clear();
      this.inFlight.clear();
      this.lastEpoch = epoch;
    }

    const compositeKey = `${epoch}::${key}`;
    const now = Date.now();
    const existing = this.store.get(compositeKey);
    if (existing && existing.epoch === epoch && existing.expiresAt > now) {
      // Refresh LRU recency
      this.store.delete(compositeKey);
      this.store.set(compositeKey, existing);
      this.hits++;
      return { value: existing.value as T, cacheStatus: 'HIT' };
    }
    if (existing) {
      this.store.delete(compositeKey);
    }

    // Single-flight deduplication: share active computation across concurrent callers
    const activePromise = this.inFlight.get(compositeKey);
    if (activePromise) {
      this.coalescedHits++;
      const value = (await activePromise) as T;
      return { value, cacheStatus: 'COALESCED' };
    }

    this.misses++;
    const computePromise = (async () => {
      try {
        const result = await factory();
        // Only commit to cache if epoch did not advance mid-flight
        if (this.lastEpoch === epoch) {
          this.evictIfNeeded();
          this.store.set(compositeKey, {
            epoch,
            value: result,
            createdAt: Date.now(),
            expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs)
          });
        }
        return result;
      } finally {
        this.inFlight.delete(compositeKey);
      }
    })();

    this.inFlight.set(compositeKey, computePromise);
    const value = await computePromise;
    return { value, cacheStatus: 'MISS' };
  }

  public getStats(): CacheStatsSnapshot {
    const total = this.hits + this.coalescedHits + this.misses;
    return {
      entries: this.store.size,
      maxEntries: this.maxEntries,
      inFlight: this.inFlight.size,
      hits: this.hits,
      misses: this.misses,
      coalescedHits: this.coalescedHits,
      evictions: this.evictions,
      hitRatePct: total > 0 ? Math.round(((this.hits + this.coalescedHits) / total) * 1000) / 10 : 0,
      lastEpoch: this.lastEpoch
    };
  }
}

export const analyticalQueryCache = new SingleFlightLruCache({
  maxEntries: 200,
  defaultTtlMs: 300_000
});

// ============================================================================
// PER-CLIENT TOKEN-BUCKET RATE LIMITER (Memory-Bounded, Proxy-Aware)
// ============================================================================

interface RateBucket {
  tokens: number;
  lastRefillMs: number;
}

export interface RateLimiterOptions {
  name: string;
  capacity: number;
  refillPerSecond: number;
  maxTrackedClients?: number;
}

function resolveClientKey(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function createTokenBucketRateLimiter(options: RateLimiterOptions) {
  const buckets = new Map<string, RateBucket>();
  const maxClients = options.maxTrackedClients ?? 5000;
  let lastPruneMs = Date.now();

  const pruneStaleBuckets = (now: number) => {
    if (now - lastPruneMs < 60_000 && buckets.size < maxClients) return;
    lastPruneMs = now;
    const staleAfterMs = Math.max(120_000, (options.capacity / options.refillPerSecond) * 2000);
    for (const [key, b] of buckets.entries()) {
      if (now - b.lastRefillMs > staleAfterMs) {
        buckets.delete(key);
      }
    }
    // Hard memory cap if under high-cardinality IP flood
    while (buckets.size > maxClients) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    if (process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMIT === 'true') {
      next();
      return;
    }

    const now = Date.now();
    pruneStaleBuckets(now);

    const clientKey = resolveClientKey(req);
    let bucket = buckets.get(clientKey);
    if (!bucket) {
      bucket = { tokens: options.capacity, lastRefillMs: now };
      buckets.set(clientKey, bucket);
    } else {
      const elapsedSec = Math.max(0, (now - bucket.lastRefillMs) / 1000);
      bucket.tokens = Math.min(options.capacity, bucket.tokens + elapsedSec * options.refillPerSecond);
      bucket.lastRefillMs = now;
    }

    if (bucket.tokens < 1) {
      const retryAfterSec = Math.max(1, Math.ceil((1 - bucket.tokens) / options.refillPerSecond));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.setHeader('X-RateLimit-Limit', String(options.capacity));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests to ${options.name}. Please retry in ${retryAfterSec}s.`
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
      return;
    }

    bucket.tokens -= 1;
    res.setHeader('X-RateLimit-Limit', String(options.capacity));
    res.setHeader('X-RateLimit-Remaining', String(Math.floor(bucket.tokens)));
    next();
  };
}

// ============================================================================
// CONCURRENCY BULKHEAD WITH BOUNDED QUEUE & GRACEFUL LOAD SHEDDING
// ============================================================================

export interface BulkheadStats {
  name: string;
  active: number;
  queued: number;
  maxConcurrent: number;
  maxQueue: number;
  peakActive: number;
  rejectedTotal: number;
}

export class ConcurrencyBulkhead {
  private readonly name: string;
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private readonly queueTimeoutMs: number;
  private active = 0;
  private peakActive = 0;
  private rejectedTotal = 0;
  private readonly queue: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(options: {
    name: string;
    maxConcurrent: number;
    maxQueue: number;
    queueTimeoutMs?: number;
  }) {
    this.name = options.name;
    this.maxConcurrent = Math.max(1, options.maxConcurrent);
    this.maxQueue = Math.max(0, options.maxQueue);
    this.queueTimeoutMs = Math.max(1_000, options.queueTimeoutMs ?? 15_000);
  }

  public async acquire(): Promise<() => void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      if (this.active > this.peakActive) this.peakActive = this.active;
      return this.createReleaseFn();
    }

    if (this.queue.length >= this.maxQueue) {
      this.rejectedTotal++;
      throw new Error(`SERVER_BUSY:${this.name}`);
    }

    await new Promise<void>((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) this.queue.splice(idx, 1);
          this.rejectedTotal++;
          reject(new Error(`QUEUE_TIMEOUT:${this.name}`));
        }, this.queueTimeoutMs)
      };
      entry.timer.unref?.();
      this.queue.push(entry);
    });

    this.active++;
    if (this.active > this.peakActive) this.peakActive = this.active;
    return this.createReleaseFn();
  }

  private createReleaseFn(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      const next = this.queue.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve();
      }
    };
  }

  public middleware() {
    return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
      let release: (() => void) | null = null;
      try {
        release = await this.acquire();
      } catch {
        res.setHeader('Retry-After', '2');
        res.status(503).json({
          success: false,
          error: {
            code: 'SERVICE_OVERLOADED',
            message: `Analytical engine is currently handling peak load (${this.name}). Please retry in a moment.`
          },
          meta: {
            timestamp: new Date().toISOString()
          }
        });
        return;
      }

      const cleanup = () => {
        if (release) {
          release();
          release = null;
        }
      };
      res.once('finish', cleanup);
      res.once('close', cleanup);
      next();
    };
  }

  public getStats(): BulkheadStats {
    return {
      name: this.name,
      active: this.active,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueue: this.maxQueue,
      peakActive: this.peakActive,
      rejectedTotal: this.rejectedTotal
    };
  }
}

export const heavyQueryBulkhead = new ConcurrencyBulkhead({
  name: 'heavy-olap-queries',
  maxConcurrent: 24,
  maxQueue: 64,
  queueTimeoutMs: 15_000
});

export const csvUploadBulkhead = new ConcurrencyBulkhead({
  name: 'csv-ingestion-pipeline',
  maxConcurrent: 2,
  maxQueue: 6,
  queueTimeoutMs: 45_000
});

// ============================================================================
// NATIVE ZLIB GZIP COMPRESSION FOR LARGE JSON RESPONSES (SSE-SAFE)
// ============================================================================

export function gzipJsonCompressionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  if (!acceptEncoding.includes('gzip')) {
    next();
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    const contentType = String(res.getHeader('Content-Type') || '');
    if (contentType.includes('text/event-stream') || res.getHeader('Content-Encoding')) {
      return originalJson(body);
    }

    const jsonString = JSON.stringify(body);
    if (!jsonString || jsonString.length < 2048) {
      return originalJson(body);
    }

    try {
      const compressed = zlib.gzipSync(Buffer.from(jsonString, 'utf8'), { level: 6 });
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Length', String(compressed.length));
      return res.send(compressed);
    } catch {
      return originalJson(body);
    }
  }) as Response['json'];

  next();
}
