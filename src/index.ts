import http from 'http';
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { AppError } from './utils/AppError';
import { streamFromS3 } from './utils/s3Uploader';
import tenantRoutes from './routes/tenantRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import solutionRoutes from './routes/solutionRoutes';
import appInstanceRoutes from './routes/appInstanceRoutes';
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import settingsRoutes from './routes/settingsRoutes';
import integrationRoutes from './routes/integrationRoutes';
import publicRoutes from './routes/publicRoutes';
import roleDefinitionRoutes from './routes/roleDefinitionRoutes';
import accountingPostingRoutes from './routes/accountingPostingRoutes';
import accountingDebugRoutes from './routes/accountingDebugRoutes';
import accountingReportRoutes from './routes/accountingReportRoutes';
import branchRoutes from './routes/branchRoutes';
import salesRoutes from './routes/salesRoutes';
import transactionRoutes from './routes/transactionRoutes';
import productRoutes from './routes/productRoutes';
import shiftRoutes from './routes/shiftRoutes';
import expenseRoutes from './routes/expenseRoutes';
import clientPaymentRoutes from './routes/clientPaymentRoutes';
import tableRoutes from './routes/tableRoutes';
import auditLogRoutes from './routes/auditLogRoutes';
import publicQrRoutes from './routes/publicQrRoutes';
import deviceRoutes from './routes/deviceRoutes';
import orderAckRoutes from './routes/orderAckRoutes';
import relayOrdersRoutes from './routes/relayOrdersRoutes';
import { initializeSocketServer } from './services/socketServer';
import prisma from './config/database';
import { serializeForJson } from './utils/serializeForJson';

// Load environment variables
dotenv.config();

function serializeErrorForLog(error: unknown): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  if (error instanceof Error) {
    safe.message = error.message;
    safe.name = error.name;
    safe.stack = error.stack;
    if ('code' in error) safe.code = (error as { code?: unknown }).code;
    if ('statusCode' in error) safe.statusCode = (error as { statusCode?: unknown }).statusCode;
    if ('isOperational' in error) safe.isOperational = (error as { isOperational?: unknown }).isOperational;
    if ('meta' in error) safe.meta = (error as { meta?: unknown }).meta;
  } else {
    safe.raw = serializeForJson(error);
  }
  return safe;
}

process.on('uncaughtException', (error: Error, origin: string) => {
  try {
    console.error(
      '[uncaughtException] fatal process error',
      JSON.stringify({
        origin,
        error: serializeErrorForLog(error),
        timestamp: new Date().toISOString(),
      }),
    );
  } catch {
    console.error('[uncaughtException] fallback log', error?.stack ?? String(error));
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  try {
    console.error(
      '[unhandledRejection] unhandled promise rejection',
      JSON.stringify({
        error: serializeErrorForLog(reason),
        promise: Object.prototype.toString.call(promise),
        timestamp: new Date().toISOString(),
      }),
    );
  } catch {
    console.error('[unhandledRejection] fallback log', String(reason));
  }
});

// Initialize Express app
const app: Application = express();
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// Trust X-Forwarded-* headers (Railway/ingress)
app.set('trust proxy', 1);

const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(
  new Set([
    'http://localhost:5173', // Local Super Admin
    'http://127.0.0.1:5173', // Local Super Admin via explicit host
    'http://localhost:5174', // Local Super Admin alternate port
    'http://127.0.0.1:5174', // Local Super Admin via explicit host alternate port
    'http://localhost:3000', // Local POS / Web
    'http://127.0.0.1:3000', // Local POS / Web via explicit host
    'https://goldenity-super-admin.vercel.app', // Production Super Admin
    process.env.FRONTEND_URL || '',
    process.env.POS_URL || '',
    ...configuredOrigins,
  ].filter(Boolean) as string[])
);

// Middleware
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const publicDir = path.resolve(process.cwd(), 'public');
try {
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  const uploadsDir = path.join(publicDir, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch {
  /* noop */
}
app.use(express.static(publicDir));

app.get('/images/*', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawPath = (req.params as Record<string, string>)['0'] || req.path.replace(/^\/images\//, '');
    const streamResult = await streamFromS3(rawPath);
    if (!streamResult || !streamResult.body) {
      next();
      return;
    }

    if (streamResult.contentType) {
      res.setHeader('Content-Type', streamResult.contentType);
    }
    if (typeof streamResult.contentLength === 'number') {
      res.setHeader('Content-Length', streamResult.contentLength);
    }
    if (streamResult.etag) {
      res.setHeader('ETag', streamResult.etag);
    }
    if (streamResult.lastModified) {
      res.setHeader('Last-Modified', streamResult.lastModified.toUTCString());
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    streamResult.body.pipe(res);
    streamResult.body.on('error', () => {
      if (!res.headersSent) {
        next();
      }
    });
  } catch {
    next();
  }
});

// Health check route
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Goldenity Admin API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

app.get('/api/v1/health/db-schema-check', async (_req: Request, res: Response) => {
  const tableRows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'tables'
  `;

  const columnRows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_records'
      AND column_name IN ('table_id', 'order_type')
  `;

  const tableExists = tableRows.length > 0;
  const columnSet = new Set(columnRows.map((row) => row.column_name));
  const requiredColumns = ['table_id', 'order_type'];
  const columnsReady = requiredColumns.every((column) => columnSet.has(column));
  const fnbReady = tableExists && columnsReady;

  res.status(200).json({
    ok: true,
    fnb_ready: fnbReady,
    details: {
      table_exists: tableExists,
      found_tables: tableRows,
      found_columns: columnRows,
      required_columns: requiredColumns,
    },
  });
});

// Root route
app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to Goldenity Admin Core API',
    version: '1.0.0',
  });
});

// API Routes
app.use('/public', publicRoutes);
app.use('/api/v1', publicQrRoutes);
app.use('/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/solutions', solutionRoutes);
app.use('/api/app-instances', appInstanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/roles', roleDefinitionRoutes);
app.use('/api/internal/accounting', accountingPostingRoutes);
app.use('/api/v1/accounting/debug', accountingDebugRoutes);
app.use('/api/v1/accounting/reports', accountingReportRoutes);
app.use('/api/v1/branches', branchRoutes);
app.use('/api/v1/sales', salesRoutes);
app.use('/api/v1/transactions', transactionRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/shifts', shiftRoutes);
app.use('/api/v1/expenses', expenseRoutes);
app.use('/api/v1/client-payments', clientPaymentRoutes);
app.use('/api/v1/tables', tableRoutes);
app.use('/api/v1/audit-logs', auditLogRoutes);
app.use('/api/v1/devices', deviceRoutes);
app.use('/api/v1/orders', orderAckRoutes);
app.use('/api/v1/relay/orders', relayOrdersRoutes);
app.use('/api/v1/branches/:branchId/devices', deviceRoutes);

// 🔴 FIX DEVICE REGISTRATION ROUTE MATCH SHIFTS/PRODUCT PATTERN:
//    Flutter POS memanggil semua core endpoint dengan pattern /v1/shifts, /v1/sales, /v1/products
//    (TANPA /api prefix) — URL rewrite / gateway yang strip /api di frontend.
//    Device routes sblmnya HANYA di-mount di /api/v1/devices → menyebabkan 404 NOT FOUND
//    ketika Flutter menggunakan convention /v1/devices/* yang sama dengan endpoints lain.
app.use('/v1/devices', deviceRoutes);
app.use('/v1/branches/:branchId/devices', deviceRoutes);
app.use('/v1/relay/orders', relayOrdersRoutes);

// ===== SPA Fallback (Frontend Super Admin Static Serve) =====
// Jika frontend di-build lalu dist di-copy ke ./public/, Express otomatis menyajikan semua route React (client-side router).
// Kecuali route API / auth / images / uploads / public yang explicit.
const EXCLUDED_PREFIXES = ['/api', '/auth', '/images', '/uploads', '/public', '/socket.io'];
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'GET') {
    next();
    return;
  }
  const url = req.originalUrl || req.url || '';
  if (EXCLUDED_PREFIXES.some((p) => url.startsWith(p))) {
    next();
    return;
  }
  const accept = (req.headers.accept || '').toLowerCase();
  const wantsJson = accept.includes('application/json');
  if (wantsJson && !accept.includes('text/html')) {
    next();
    return;
  }
  const indexPath = path.join(publicDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    next();
    return;
  }
  res.sendFile(indexPath);
});


// 404 Handler - Route not found
app.use((req: Request, _res: Response, next: NextFunction) => {
  const error = new AppError(`Route ${req.originalUrl} not found`, 404);
  next(error);
});

// Global error handler
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  const statusCode = Number(err.statusCode) || 500;
  const tenantId = String((req as Request & { user?: { tenantId?: string } }).user?.tenantId ?? '').trim() || null;
  const userId = String((req as Request & { user?: { userId?: string } }).user?.userId ?? '').trim() || null;
  const errorPayload = serializeErrorForLog(err);

  if (statusCode >= 500 || !Boolean(err.isOperational)) {
    console.error(
      '[globalErrorHandler] operational failure',
      JSON.stringify({
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        referer: req.header('referer') || null,
        userAgent: req.header('user-agent') || null,
        tenantId,
        userId,
        statusCode,
        error: errorPayload,
        timestamp: new Date().toISOString(),
      }),
    );
  } else if (process.env.NODE_ENV !== 'production') {
    console.warn(
      '[globalErrorHandler] client/validation error',
      JSON.stringify({
        method: req.method,
        url: req.originalUrl,
        tenantId,
        userId,
        statusCode,
        error: errorPayload,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  if (process.env.NODE_ENV === 'development') {
    res.status(statusCode).json({
      success: false,
      error: err.message ?? 'Internal error',
      stack: err.stack ?? null,
      statusCode,
    });
    return;
  }

  const safeMessage = err.isOperational && typeof err.message === 'string' && err.message.length > 0
    ? err.message
    : 'Something went wrong';
  res.status(statusCode).json({
    success: false,
    error: safeMessage,
    statusCode,
  });
});

initializeSocketServer(server);

// Start server
server.listen({ port: Number(PORT), host: '0.0.0.0' }, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV}`);
  console.log(`🔗 Health check: http://0.0.0.0:${PORT}/api/health`);
});

export default app;
