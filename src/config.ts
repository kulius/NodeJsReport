import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const isPkg = !!(process as any).pkg;

// In pkg: exe directory. In dev: project root.
const baseDir = isPkg
  ? path.dirname(process.execPath)
  : path.join(__dirname, '..');

// In pkg: public/ is packed into the snapshot filesystem, accessed via __dirname
// In dev: public/ is at project root
const publicDir = path.join(__dirname, '..', 'public');

function readVersion(): string {
  const candidates = [
    path.join(baseDir, 'package.json'),
    path.join(__dirname, '..', 'package.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return pkg.version || '0.0.0';
      }
    } catch { /* skip */ }
  }
  return '0.0.0';
}

export const config = {
  port: parseInt(process.env.PORT || '39500', 10),
  host: process.env.HOST || '127.0.0.1',
  logLevel: process.env.LOG_LEVEL || 'info',
  defaultPrinter: process.env.DEFAULT_PRINTER || '',
  watchDir: process.env.WATCH_DIR || 'D:/print_queue',
  fontDir: process.env.FONT_DIR || path.join(baseDir, 'data', 'fonts'),
  dataDir: path.join(baseDir, 'data'),
  uploadsDir: path.join(baseDir, 'data', 'uploads'),
  outputDir: path.join(baseDir, 'data', 'output'),
  templatesDir: path.join(baseDir, 'data', 'templates'),
  publicDir,
  isPkg,
  baseDir,
  version: readVersion(),
  github: {
    owner: process.env.GITHUB_OWNER || 'kulius',
    repo: process.env.GITHUB_REPO || 'NodeJsReport',
    releaseAssetName: process.env.GITHUB_ASSET_NAME || 'nodejs-report.exe',
  },
} as const;
