import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { config } from '../config';
import { excelToPdf } from './excel.service';
import { printPdfBuffer } from './printer.service';
import { createJob, updateJobStatus } from './job-queue.service';

export interface WatchDirConfig {
  readonly path: string;
  readonly printer?: string;
  readonly paperSize: string;
  readonly autoStart: boolean;
  readonly moveAfterPrint: boolean;
  readonly processedDir: string;
}

export interface WatcherStatus {
  readonly active: boolean;
  readonly directory: string;
  readonly printer: string;
  readonly paperSize: string;
  readonly processedFiles: readonly ProcessedFileRecord[];
}

export interface ProcessedFileRecord {
  readonly filename: string;
  readonly processedAt: string;
  readonly status: 'success' | 'failed';
  readonly error?: string;
}

const CONFIG_FILE = path.join(config.dataDir, 'watcher-config.json');

let watcher: ReturnType<typeof chokidar.watch> | null = null;
let currentConfig: WatchDirConfig | null = null;
let processedFiles: ProcessedFileRecord[] = [];
let isProcessing = false;
const pendingFiles: string[] = [];

// Event emitter for Socket.IO integration
type WatcherEventHandler = (event: string, data: unknown) => void;
let eventHandler: WatcherEventHandler | null = null;

export function setWatcherEventHandler(handler: WatcherEventHandler): void {
  eventHandler = handler;
}

function emitEvent(event: string, data: unknown): void {
  if (eventHandler) {
    eventHandler(event, data);
  }
}

/** Load watcher config from disk */
export function loadWatcherConfig(): WatchDirConfig | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      return parsed.watchDirs?.[0] || null;
    }
  } catch (error) {
    logger.error({ error }, 'Failed to load watcher config');
  }
  return null;
}

/** Save watcher config to disk */
function saveWatcherConfig(cfg: WatchDirConfig): void {
  const data = { watchDirs: [cfg] };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/** Process an Excel file: convert to PDF and print */
async function processExcelFile(filePath: string): Promise<void> {
  const filename = path.basename(filePath);

  if (!currentConfig) return;

  logger.info({ filename }, 'Processing Excel file');
  emitEvent('watcher:processing', { filename });

  const job = createJob({
    printer: currentConfig.printer || '(system default)',
    mode: 'pdf',
    copies: 1,
    paperSize: currentConfig.paperSize,
    source: `watcher:${filename}`,
  });

  try {
    updateJobStatus(job.id, 'printing');

    // Convert Excel to PDF
    const pdfBuffer = await excelToPdf(filePath, {
      paperSize: currentConfig.paperSize,
    });

    // Print the PDF
    await printPdfBuffer(pdfBuffer, {
      printer: currentConfig.printer,
      paperSize: currentConfig.paperSize,
    });

    updateJobStatus(job.id, 'completed');

    // Move to processed directory
    if (currentConfig.moveAfterPrint) {
      const processedDir = currentConfig.processedDir;
      if (!fs.existsSync(processedDir)) {
        fs.mkdirSync(processedDir, { recursive: true });
      }
      const destPath = path.join(processedDir, filename);
      fs.renameSync(filePath, destPath);
      logger.info({ filename, dest: destPath }, 'File moved to processed');
    }

    processedFiles = [
      { filename, processedAt: new Date().toISOString(), status: 'success' as const },
      ...processedFiles,
    ].slice(0, 100); // Keep last 100 records

    emitEvent('watcher:completed', { filename, jobId: job.id });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error, filename }, 'Failed to process Excel file');
    updateJobStatus(job.id, 'failed', errMsg);

    processedFiles = [
      { filename, processedAt: new Date().toISOString(), status: 'failed' as const, error: errMsg },
      ...processedFiles,
    ].slice(0, 100);

    emitEvent('watcher:failed', { filename, error: errMsg });
  }
}

/** Process the pending file queue sequentially */
async function processQueue(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  while (pendingFiles.length > 0) {
    const filePath = pendingFiles.shift()!;
    try {
      // Brief delay to ensure file write is complete
      await new Promise((r) => setTimeout(r, 1000));
      if (fs.existsSync(filePath)) {
        await processExcelFile(filePath);
      }
    } catch (error) {
      logger.error({ error, filePath }, 'Queue processing error');
    }
  }

  isProcessing = false;
}

/** Start watching a directory */
export function startWatcher(cfg: {
  directory: string;
  printer?: string;
  paperSize?: string;
  moveAfterPrint?: boolean;
}): WatcherStatus {
  if (watcher) {
    stopWatcher();
  }

  const watchConfig: WatchDirConfig = {
    path: cfg.directory,
    printer: cfg.printer,
    paperSize: cfg.paperSize || 'A4',
    autoStart: true,
    moveAfterPrint: cfg.moveAfterPrint !== false,
    processedDir: path.join(cfg.directory, 'processed'),
  };

  // Ensure directory exists
  if (!fs.existsSync(watchConfig.path)) {
    fs.mkdirSync(watchConfig.path, { recursive: true });
  }

  currentConfig = watchConfig;
  saveWatcherConfig(watchConfig);

  const xlsPattern = path.join(watchConfig.path, '**/*.{xls,xlsx}').replace(/\\/g, '/');

  watcher = chokidar.watch(xlsPattern, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 500,
    },
    ignored: [
      /(^|[\/\\])\./, // dotfiles
      /processed/,     // processed directory
    ],
  });

  watcher.on('add', (filePath: string) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.xls' || ext === '.xlsx') {
      logger.info({ filePath }, 'New Excel file detected');
      pendingFiles.push(filePath);
      processQueue();
    }
  });

  watcher.on('error', (error: unknown) => {
    logger.error({ error }, 'Watcher error');
    emitEvent('watcher:error', { error: error instanceof Error ? error.message : String(error) });
  });

  logger.info({ directory: watchConfig.path }, 'Watcher started');
  emitEvent('watcher:started', { directory: watchConfig.path });

  return getWatcherStatus();
}

/** Stop the file watcher */
export function stopWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (currentConfig) {
    currentConfig = { ...currentConfig, autoStart: false };
    saveWatcherConfig(currentConfig);
  }
  pendingFiles.length = 0;
  logger.info('Watcher stopped');
  emitEvent('watcher:stopped', {});
}

/** Get current watcher status */
export function getWatcherStatus(): WatcherStatus {
  return {
    active: watcher !== null,
    directory: currentConfig?.path || '',
    printer: currentConfig?.printer || '(system default)',
    paperSize: currentConfig?.paperSize || 'A4',
    processedFiles,
  };
}

/** Auto-start watcher if configured */
export function autoStartWatcher(): void {
  const cfg = loadWatcherConfig();
  if (cfg?.autoStart) {
    logger.info({ directory: cfg.path }, 'Auto-starting watcher');
    startWatcher({
      directory: cfg.path,
      printer: cfg.printer,
      paperSize: cfg.paperSize,
      moveAfterPrint: cfg.moveAfterPrint,
    });
  }
}
