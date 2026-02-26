import { print, getPrinters } from 'pdf-to-printer';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface PrinterInfo {
  readonly name: string;
  readonly isDefault: boolean;
}

export interface PrintPdfOptions {
  readonly printer?: string;
  readonly copies?: number;
  readonly paperSize?: string;
  readonly silent?: boolean;
}

/** List available printers on the system */
export async function listPrinters(): Promise<PrinterInfo[]> {
  try {
    const printers = await getPrinters();
    return printers.map((p) => ({
      name: p.name,
      isDefault: p.name === config.defaultPrinter,
    }));
  } catch (error) {
    logger.error({ error }, 'Failed to list printers');
    throw new Error('Failed to list printers');
  }
}

/** Get the effective printer name (explicit > config default > system default) */
export function resolveprinterName(explicit?: string): string | undefined {
  return explicit || config.defaultPrinter || undefined;
}

/** Print a PDF buffer to a printer */
export async function printPdfBuffer(
  pdfBuffer: Buffer,
  options: PrintPdfOptions = {}
): Promise<{ jobId: string; printer: string }> {
  const jobId = uuidv4();
  const tmpFile = path.join(config.outputDir, `print-${jobId}.pdf`);

  try {
    fs.writeFileSync(tmpFile, pdfBuffer);

    const printer = resolveprinterName(options.printer);
    const printOptions: Record<string, string> = {};

    if (printer) {
      printOptions.printer = printer;
    }
    if (options.copies && options.copies > 1) {
      printOptions.copies = String(options.copies);
    }

    await print(tmpFile, printOptions);

    const usedPrinter = printer || '(system default)';
    logger.info({ jobId, printer: usedPrinter }, 'PDF printed successfully');

    return { jobId, printer: usedPrinter };
  } catch (error) {
    logger.error({ error, jobId }, 'Failed to print PDF');
    throw new Error(`Print failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Clean up temp file after a delay (printer may still be reading it)
    setTimeout(() => {
      try {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      } catch {
        // Ignore cleanup errors
      }
    }, 30_000);
  }
}

/** Print a PDF file from disk */
export async function printPdfFile(
  filePath: string,
  options: PrintPdfOptions = {}
): Promise<{ jobId: string; printer: string }> {
  const buffer = fs.readFileSync(filePath);
  return printPdfBuffer(buffer, options);
}
