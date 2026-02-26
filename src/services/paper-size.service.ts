import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';
import { type PaperSize, BUILT_IN_PAPER_SIZES } from '../models/paper-size.model';
import { mmToPt } from '../utils/unit-converter';

const CUSTOM_SIZES_FILE = path.join(config.dataDir, 'paper-sizes.json');

let customSizes: PaperSize[] = [];

/** Load custom paper sizes from disk */
function loadCustomSizes(): void {
  try {
    if (fs.existsSync(CUSTOM_SIZES_FILE)) {
      const raw = fs.readFileSync(CUSTOM_SIZES_FILE, 'utf-8');
      customSizes = JSON.parse(raw);
    }
  } catch (error) {
    logger.error({ error }, 'Failed to load custom paper sizes');
    customSizes = [];
  }
}

/** Save custom paper sizes to disk */
function saveCustomSizes(): void {
  fs.writeFileSync(CUSTOM_SIZES_FILE, JSON.stringify(customSizes, null, 2), 'utf-8');
}

/** Initialize - load custom sizes on startup */
export function initPaperSizes(): void {
  loadCustomSizes();
  logger.info({ builtIn: BUILT_IN_PAPER_SIZES.length, custom: customSizes.length }, 'Paper sizes loaded');
}

/** Get all paper sizes (built-in + custom) */
export function getAllPaperSizes(): PaperSize[] {
  return [...BUILT_IN_PAPER_SIZES, ...customSizes];
}

/** Get a paper size by ID */
export function getPaperSize(id: string): PaperSize | undefined {
  return getAllPaperSizes().find((s) => s.id === id);
}

/** Get paper size dimensions in PDF points for pdfmake */
export function getPaperSizeInPt(id: string): { width: number; height: number } | undefined {
  const size = getPaperSize(id);
  if (!size) return undefined;
  return {
    width: mmToPt(size.widthMm),
    height: mmToPt(size.heightMm),
  };
}

/** Add a custom paper size */
export function addCustomPaperSize(size: Omit<PaperSize, 'builtIn'>): PaperSize {
  const existing = getAllPaperSizes().find((s) => s.id === size.id);
  if (existing) {
    throw new Error(`Paper size '${size.id}' already exists`);
  }

  const newSize: PaperSize = { ...size, builtIn: false };
  customSizes = [...customSizes, newSize];
  saveCustomSizes();
  logger.info({ id: size.id }, 'Custom paper size added');
  return newSize;
}

/** Delete a custom paper size */
export function deleteCustomPaperSize(id: string): boolean {
  const idx = customSizes.findIndex((s) => s.id === id);
  if (idx === -1) return false;

  customSizes = customSizes.filter((s) => s.id !== id);
  saveCustomSizes();
  logger.info({ id }, 'Custom paper size deleted');
  return true;
}
