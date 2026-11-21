import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './server/routes/api';
import { duckdbEngine } from './server/db/duckdbEngine';
import { gzipJsonCompressionMiddleware } from './server/services/resilienceLayer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseCliArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  const prefix = `${flag}=`;
  const matched = process.argv.find((arg) => arg.startsWith(prefix));
  return matched ? matched.slice(prefix.length) : undefined;
}

async function startServer() {
  const app = express();
  const cliPort = parseCliArg('--port');
  const cliHost = parseCliArg('--host');
  const PORT = Number(process.env.PORT || cliPort || 3000);
  const HOST = cliHost || '0.0.0.0';

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Production security headers (iframe-compatible for AI Studio preview & embedded SaaS)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(self), camera=()');
    next();
  });

  // Route-scoped large body limit ONLY for bulk CSV ingestion; strict 2MB ceiling everywhere else
  app.use('/api/datasets/upload-csv', express.json({ limit: '120mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ limit: '2mb', extended: true }));

  // Native gzip compression for large JSON analytical responses (>= 2KB, SSE-safe)
  app.use('/api', gzipJsonCompressionMiddleware);

  // Mount REST API routes
  app.use('/api', apiRouter);

  // Structured JSON 404 handler for unknown API routes (never return HTML for /api/*)
  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'API_ROUTE_NOT_FOUND',
        message: `Endpoint ${req.method} ${req.originalUrl} does not exist.`
      },
      meta: {
        timestamp: new Date().toISOString(),
        dataMode: duckdbEngine.getDataMode(),
        isDemonstrationData: duckdbEngine.isDemonstrationData()
      }
    });
  });

  // Centralized error handler (malformed JSON payloads, oversized bodies, unexpected errors)
  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const status =
      err.type === 'entity.too.large'
        ? 413
        : err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    const code =
      status === 413
        ? 'PAYLOAD_TOO_LARGE'
        : status === 400
          ? 'INVALID_REQUEST_PAYLOAD'
          : 'INTERNAL_SERVER_ERROR';
    const message =
      status === 413
        ? 'Request payload exceeds the endpoint safety limit. Split large uploads into batches under 120MB.'
        : status === 400
          ? 'Malformed JSON request payload.'
          : 'An unexpected server error occurred.';
    res.status(status).json({
      success: false,
      error: { code, message },
      meta: {
        timestamp: new Date().toISOString(),
        dataMode: duckdbEngine.getDataMode(),
        isDemonstrationData: duckdbEngine.isDemonstrationData()
      }
    });
  });

  const isDev = process.env.NODE_ENV !== 'production';
  const disableHmr = process.env.DISABLE_HMR === 'true';

  // Initialize DuckDB and Vite middleware concurrently for fast, reliable boot
  const [, vite] = await Promise.all([
    duckdbEngine.ensureInitialized(),
    isDev
      ? createViteServer({
          server: {
            middlewareMode: true,
            allowedHosts: true,
            hmr: disableHmr ? false : undefined,
            watch: disableHmr ? null : undefined
          },
          appType: 'spa'
        })
      : Promise.resolve(null)
  ]);

  if (isDev && vite) {
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath, { maxAge: '1h', index: false }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`RetailPulse Enterprise server listening on http://${HOST}:${PORT}`);
  });

  // HTTP server socket hardening for load balancers & slow-client protection
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 120_000;

  let shuttingDown = false;
  const gracefulShutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}. Closing RetailPulse Enterprise server cleanly...`);
    server.close(async () => {
      try {
        await duckdbEngine.close();
      } catch (err) {
        console.error('Error closing DuckDB engine cleanly:', err);
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start RetailPulse Enterprise server:', err);
  process.exit(1);
});
