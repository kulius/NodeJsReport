import fs from 'fs';
import https from 'https';
import path from 'path';
import { config } from '../config';
import { logger } from './logger';

const NOTO_SANS_TC_URL =
  'https://github.com/google/fonts/raw/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf';

const FONT_FILENAME = 'NotoSansTC-Regular.ttf';

/** Follow redirects (GitHub raw → objects storage) */
function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const request = (u: string) => {
      https.get(u, { headers: { 'User-Agent': 'NodeJsReport' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (location) {
            res.resume();
            return request(location);
          }
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
    };
    request(url);
  });
}

/**
 * Ensure CJK font exists in data/fonts/.
 * Downloads NotoSansTC from Google Fonts if missing.
 */
export async function ensureFonts(): Promise<void> {
  const fontPath = path.join(config.fontDir, FONT_FILENAME);

  if (fs.existsSync(fontPath)) {
    logger.info({ fontPath }, 'CJK font found');
    return;
  }

  // Ensure directory exists
  fs.mkdirSync(config.fontDir, { recursive: true });

  logger.info('CJK font not found, downloading NotoSansTC...');
  try {
    const tmpPath = fontPath + '.tmp';
    await download(NOTO_SANS_TC_URL, tmpPath);
    fs.renameSync(tmpPath, fontPath);
    logger.info({ fontPath }, 'NotoSansTC downloaded successfully');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, 'Failed to download NotoSansTC. Reports requiring CJK will fail.');
  }
}
