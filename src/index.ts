import http from 'http';
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { AppError } from './utils/AppError';
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
import accountingReportRoutes from './routes/accountingReportRoutes';
import branchRoutes from './routes/branchRoutes';
import salesRoutes from './routes/salesRoutes';
import { initializeSocketServer } from './services/socketServer';

// Load environment variables
dotenv.config();

// Initialize Express app
const app: Application = express();
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// Trust X-Forwarded-* headers (Railway/ingress)
app.set('trust proxy', 1);

// Middleware
app.use(cors({
  origin: '*',
  credentials: false,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check route
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Goldenity Admin API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
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
app.use('/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/solutions', solutionRoutes);
app.use('/api/app-instances', appInstanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/roles', roleDefinitionRoutes);
app.use('/api/internal/accounting', accountingPostingRoutes);
app.use('/api/v1/accounting/reports', accountingReportRoutes);
app.use('/api/v1/branches', branchRoutes);
app.use('/api/v1/sales', salesRoutes);


// 404 Handler - Route not found
app.use((req: Request, _res: Response, next: NextFunction) => {
  const error = new AppError(`Route ${req.originalUrl} not found`, 404);
  next(error);
});

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      stack: err.stack,
      statusCode: err.statusCode,
    });
  } else {
    // Production mode - don't leak error details
    res.status(err.statusCode).json({
      success: false,
      error: err.isOperational ? err.message : 'Something went wrong',
    });
  }
});

initializeSocketServer(server);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
});

export default app;
