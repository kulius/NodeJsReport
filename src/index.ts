import express from 'express';
import cors from 'cors';
import path from 'path';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config';
import { logger } from './utils/logger';
import { initPaperSizes, getAllPaperSizes, addCustomPaperSize } from './services/paper-size.service';
import { loadTemplates } from './services/template.service';
import { autoStartWatcher, setWatcherEventHandler } from './services/watcher.service';
import { ensureDesktopShortcut } from './services/shortcut.service';
import { ensureFonts } from './utils/font-init';

// Routes
import printerRoutes from './routes/printer.routes';
import printRoutes from './routes/print.routes';
import reportRoutes from './routes/report.routes';
import overlayRoutes from './routes/overlay.routes';
import templateRoutes from './routes/template.routes';
import previewRoutes from './routes/preview.routes';
import jobRoutes from './routes/job.routes';
import watcherRoutes from './routes/watcher.routes';
import excelRoutes from './routes/excel.routes';
import updaterRoutes from './routes/updater.routes';
import generateRoutes from './routes/generate.routes';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files (Web UI)
// In pkg: public/ is in the snapshot filesystem (accessible via __dirname)
// In dev: public/ is at project root (also accessible via __dirname/../public)
app.use(express.static(config.publicDir));

// API Routes
app.use('/api/printers', printerRoutes);
app.use('/api/print', printRoutes);
app.use('/api/report', reportRoutes);
app.use('/api/overlay', overlayRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/preview', previewRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/watcher', watcherRoutes);
app.use('/api/excel', excelRoutes);
app.use('/api/updater', updaterRoutes);
app.use('/api/generate', generateRoutes);

// Paper sizes API (inline, small enough)
app.get('/api/paper-sizes', (_req, res) => {
  res.json({ success: true, data: getAllPaperSizes() });
});

app.post('/api/paper-sizes', (req, res) => {
  try {
    const { id, name, widthMm, heightMm } = req.body;
    if (!id || !name || !widthMm || !heightMm) {
      return res.status(400).json({ success: false, error: 'id, name, widthMm, heightMm are required' });
    }
    const size = addCustomPaperSize({ id, name, widthMm, heightMm });
    res.status(201).json({ success: true, data: size });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(400).json({ success: false, error: msg });
  }
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    service: 'NodeJsReport',
    version: config.version,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    isPkg: config.isPkg,
  });
});

// Socket.IO connection
io.on('connection', (socket) => {
  logger.info({ id: socket.id }, 'Client connected');

  socket.on('disconnect', () => {
    logger.info({ id: socket.id }, 'Client disconnected');
  });
});

// Wire watcher events to Socket.IO
setWatcherEventHandler((event, data) => {
  io.emit(event, data);
});

// Initialize services
initPaperSizes();
loadTemplates();
ensureFonts().catch((err) => logger.error({ error: String(err) }, 'Font init failed'));

// Start server
server.listen(config.port, config.host, () => {
  logger.info({ port: config.port, host: config.host }, 'NodeJsReport server started');
  logger.info(`Dashboard: http://localhost:${config.port}`);

  // Auto-start watcher if configured
  autoStartWatcher();

  // Create desktop shortcut on first run (pkg only)
  ensureDesktopShortcut();
});

export { app, server, io };
