import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { config } from '../config';
import { logger } from '../utils/logger';

const SHORTCUT_NAME = 'NodeJsReport.lnk';
const MARKER_FILE = path.join(config.dataDir, '.shortcut-created');

function getDesktopPath(): string {
  return path.join(os.homedir(), 'Desktop');
}

function createShortcut(targetUrl: string, shortcutPath: string): boolean {
  const ps1 = `
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')
$sc.TargetPath = '${targetUrl}'
$sc.IconLocation = 'shell32.dll,14'
$sc.Description = 'NodeJsReport 列印服務'
$sc.Save()
`;

  try {
    execSync(`powershell -NoProfile -Command "${ps1.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      windowsHide: true,
      timeout: 10000,
    });
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
  const ok = createShortcut(url, shortcutPath);

  if (ok) {
    fs.writeFileSync(MARKER_FILE, new Date().toISOString(), 'utf-8');
    logger.info({ path: shortcutPath }, 'Desktop shortcut created');
  }
}
