import path from 'path';
import fs from 'fs';
import os from 'os';
import { config } from '../config';
import { logger } from '../utils/logger';

const SHORTCUT_NAME = 'NodeJsReport.url';
const MARKER_FILE = path.join(config.dataDir, '.shortcut-created');

function getDesktopPath(): string {
  return path.join(os.homedir(), 'Desktop');
}

/** Create a .url shortcut (no COM dependency, works on all Windows) */
function createUrlShortcut(targetUrl: string, shortcutPath: string): boolean {
  try {
    const content = `[InternetShortcut]\r\nURL=${targetUrl}\r\nIconIndex=14\r\nIconFile=shell32.dll\r\n`;
    fs.writeFileSync(shortcutPath, content, 'utf-8');
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to create desktop shortcut');
    return false;
  }
}

export function ensureDesktopShortcut(): void {
  if (!config.isPkg) return;

  if (fs.existsSync(MARKER_FILE)) return;

  const desktop = getDesktopPath();
  if (!fs.existsSync(desktop)) return;

  const shortcutPath = path.join(desktop, SHORTCUT_NAME);
  if (fs.existsSync(shortcutPath)) {
    fs.writeFileSync(MARKER_FILE, new Date().toISOString(), 'utf-8');
    return;
  }

  const url = `http://localhost:${config.port}`;
  const ok = createUrlShortcut(url, shortcutPath);

  if (ok) {
    fs.writeFileSync(MARKER_FILE, new Date().toISOString(), 'utf-8');
    logger.info({ path: shortcutPath }, 'Desktop shortcut created');
  }
}
