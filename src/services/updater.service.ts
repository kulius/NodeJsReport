import https from 'https';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { config } from '../config';
import { logger } from '../utils/logger';

interface ReleaseInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
  releaseNotes: string;
  publishedAt: string;
}

interface UpdateStatus {
  currentVersion: string;
  lastCheck: string | null;
  lastResult: ReleaseInfo | null;
}

interface UpdateState {
  readonly lastCheck: string | null;
  readonly lastResult: ReleaseInfo | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

let state: UpdateState = { lastCheck: null, lastResult: null };

function httpsGet(url: string, maxRedirects = 5): Promise<{ statusCode: number; headers: any; body: string }> {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) {
      reject(new Error('Too many redirects'));
      return;
    }

    const options = {
      headers: { 'User-Agent': 'NodeJsReport-Updater' },
    };

    const req = https.get(url, options, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        httpsGet(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
        return;
      }

      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body,
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function validateDownloadUrl(url: string): boolean {
  const { owner, repo } = config.github;
  const allowedPrefix = `https://github.com/${owner}/${repo}/releases/download/`;
  return url.startsWith(allowedPrefix);
}

export async function checkForUpdate(force = false): Promise<ReleaseInfo> {
  // Return cached result if within TTL
  if (!force && state.lastCheck && state.lastResult) {
    const elapsed = Date.now() - new Date(state.lastCheck).getTime();
    if (elapsed < CACHE_TTL_MS) {
      return state.lastResult;
    }
  }

  const { owner, repo, releaseAssetName } = config.github;
  const currentVersion = config.version;

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  logger.info({ apiUrl }, 'Checking for updates');

  const response = await httpsGet(apiUrl);

  if (response.statusCode === 404) {
    const result: ReleaseInfo = {
      available: false,
      currentVersion,
      latestVersion: currentVersion,
      downloadUrl: '',
      releaseNotes: 'No releases found',
      publishedAt: '',
    };
    state = { ...state, lastCheck: new Date().toISOString(), lastResult: result };
    return result;
  }

  if (response.statusCode !== 200) {
    throw new Error(`GitHub API returned ${response.statusCode}`);
  }

  const release = JSON.parse(response.body);
  const latestVersion = (release.tag_name || '').replace(/^v/, '');

  const asset = (release.assets || []).find(
    (a: any) => a.name === releaseAssetName
  );

  const downloadUrl = asset?.browser_download_url || '';
  const available = compareVersions(latestVersion, currentVersion) > 0;

  const result: ReleaseInfo = {
    available,
    currentVersion,
    latestVersion,
    downloadUrl,
    releaseNotes: release.body || '',
    publishedAt: release.published_at || '',
  };

  state = { ...state, lastCheck: new Date().toISOString(), lastResult: result };

  logger.info({ currentVersion, latestVersion, available }, 'Update check complete');
  return result;
}

export function getUpdateStatus(): UpdateStatus {
  return {
    currentVersion: config.version,
    lastCheck: state.lastCheck,
    lastResult: state.lastResult,
  };
}

function downloadFile(url: string, destPath: string, maxRedirects = 5, timeoutMs = 120000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) {
      reject(new Error('Too many redirects'));
      return;
    }

    const timer = setTimeout(() => {
      fs.unlink(destPath, () => {});
      reject(new Error('Download timeout'));
    }, timeoutMs);

    const options = {
      headers: { 'User-Agent': 'NodeJsReport-Updater' },
    };

    const doRequest = (reqUrl: string, redirectsLeft: number) => {
      https.get(reqUrl, options, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          if (redirectsLeft <= 0) {
            clearTimeout(timer);
            reject(new Error('Too many redirects'));
            return;
          }
          doRequest(res.headers.location, redirectsLeft - 1);
          return;
        }

        if (res.statusCode !== 200) {
          clearTimeout(timer);
          reject(new Error(`Download failed with status ${res.statusCode}`));
          return;
        }

        const file = fs.createWriteStream(destPath);

        res.pipe(file);

        file.on('finish', () => {
          clearTimeout(timer);
          file.close();
          resolve();
        });

        file.on('error', (err) => {
          clearTimeout(timer);
          fs.unlink(destPath, () => {});
          reject(err);
        });
      }).on('error', (err) => {
        clearTimeout(timer);
        fs.unlink(destPath, () => {});
        reject(err);
      });
    };

    doRequest(url, maxRedirects);
  });
}

/** Escape a string for embedding in a PowerShell double-quoted string.
 *  Note: backslashes are NOT escape chars in PS — only backtick is. */
function escapePsString(s: string): string {
  return s
    .replace(/`/g, '``')
    .replace(/"/g, '`"')
    .replace(/\$/g, '`$');
}

export async function applyUpdate(downloadUrl: string, version: string): Promise<{ message: string }> {
  if (!config.isPkg) {
    throw new Error('Auto-update is only available in the packaged exe version');
  }

  // Validate version format
  if (!SEMVER_REGEX.test(version)) {
    throw new Error('Invalid version format');
  }

  // Validate download URL matches configured GitHub repo
  if (!validateDownloadUrl(downloadUrl)) {
    throw new Error('Invalid download URL: must be from the configured GitHub repository');
  }

  const exePath = process.execPath;
  const exeDir = path.dirname(exePath);
  const exeName = path.basename(exePath);
  const updateExePath = path.join(config.outputDir, `update-${version}.exe`);
  const scriptPath = path.join(config.outputDir, 'update.ps1');

  fs.mkdirSync(config.outputDir, { recursive: true });

  logger.info({ downloadUrl, updateExePath }, 'Downloading update');
  await downloadFile(downloadUrl, updateExePath);

  const stat = fs.statSync(updateExePath);
  if (stat.size < 1024 * 1024) {
    fs.unlinkSync(updateExePath);
    throw new Error('Downloaded file is too small, likely corrupted');
  }

  const psProcessName = escapePsString(path.parse(exeName).name);
  const psUpdatePath = escapePsString(updateExePath);
  const psExePath = escapePsString(exePath);
  const psExeDir = escapePsString(exeDir);
  const psLogPath = escapePsString(path.join(config.outputDir, 'update.log'));

  const psScript = `
# NodeJsReport Auto-Update Script
$logFile = "${psLogPath}"
function Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Out-File -Append -FilePath $logFile }

Log "Update started"
Start-Sleep -Seconds 3

# Wait for the old process to exit
$processName = "${psProcessName}"
$maxWait = 30
$waited = 0
while ((Get-Process -Name $processName -ErrorAction SilentlyContinue) -and $waited -lt $maxWait) {
    Start-Sleep -Seconds 1
    $waited++
}
Log "Waited $waited seconds for process to exit"

# Force kill if still running
Stop-Process -Name $processName -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Replace the exe
try {
    Copy-Item "${psUpdatePath}" -Destination "${psExePath}" -Force
    Log "File copied successfully"
} catch {
    Log "Copy failed: $_"
    exit 1
}

# Clean up the update file
Remove-Item "${psUpdatePath}" -Force -ErrorAction SilentlyContinue

# Restart the application
try {
    Start-Process -FilePath "${psExePath}" -WorkingDirectory "${psExeDir}"
    Log "Process started successfully"
} catch {
    Log "Start failed: $_"
    exit 1
}

# Self-delete
Start-Sleep -Seconds 3
Remove-Item $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
`.trim();

  fs.writeFileSync(scriptPath, psScript, 'utf-8');

  logger.info({ scriptPath }, 'Update script created, launching update process');

  const child = spawn('powershell.exe', [
    '-ExecutionPolicy', 'Bypass',
    '-NoProfile',
    '-File', scriptPath,
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  child.unref();

  setTimeout(() => {
    logger.info('Exiting for update...');
    process.exit(0);
  }, 1000);

  return { message: `Updating to v${version}. The service will restart shortly.` };
}
