import net from 'net';
import { logger } from '../utils/logger';

/**
 * ESC/P Command Builder for dot-matrix printers (e.g., EPSON LQ series).
 *
 * Reference: Epson ESC/P Reference Manual
 * - ESC @ : Initialize printer
 * - ESC $ nL nH : Set absolute horizontal position
 * - ESC J n : Advance paper n/180 inches
 * - ESC ! n : Select print mode (bold, double-width, etc.)
 * - FF : Form Feed
 */

/** ESC/P control codes */
const ESC = 0x1b;
const FF = 0x0c;   // Form Feed
const CR = 0x0d;   // Carriage Return
const LF = 0x0a;   // Line Feed

export interface EscpField {
  readonly text: string;
  readonly x: number;      // Horizontal position in 1/60 inch units
  readonly y: number;      // Vertical position in 1/180 inch units (from current position)
  readonly bold?: boolean;
  readonly doubleWidth?: boolean;
  readonly fontSize?: 'normal' | 'condensed' | 'elite';
}

export interface EscpDocument {
  readonly fields: readonly EscpField[];
  readonly formFeed?: boolean; // Send FF at end (default true)
}

/** Build ESC/P command buffer for a document */
export function buildEscpBuffer(doc: EscpDocument): Buffer {
  const parts: Buffer[] = [];

  // Initialize printer
  parts.push(Buffer.from([ESC, 0x40])); // ESC @

  // Sort fields by Y position for sequential printing
  const sortedFields = [...doc.fields].sort((a, b) => a.y - b.y);

  let currentY = 0;

  for (const field of sortedFields) {
    // Vertical positioning: advance from current position
    const yAdvance = field.y - currentY;
    if (yAdvance > 0) {
      // ESC J n : advance n/180 inches
      // For large advances, use multiple ESC J commands (max 255)
      let remaining = yAdvance;
      while (remaining > 0) {
        const advance = Math.min(remaining, 255);
        parts.push(Buffer.from([ESC, 0x4a, advance]));
        remaining -= advance;
      }
      currentY = field.y;
    }

    // Carriage return before horizontal positioning
    parts.push(Buffer.from([CR]));

    // Horizontal positioning: ESC $ nL nH
    const xLow = field.x & 0xff;
    const xHigh = (field.x >> 8) & 0xff;
    parts.push(Buffer.from([ESC, 0x24, xLow, xHigh]));

    // Set print mode
    let printMode = 0;
    if (field.bold) printMode |= 0x08;
    if (field.doubleWidth) printMode |= 0x20;
    parts.push(Buffer.from([ESC, 0x21, printMode]));

    // Font size
    if (field.fontSize === 'condensed') {
      parts.push(Buffer.from([0x0f])); // SI - condensed mode
    } else if (field.fontSize === 'elite') {
      parts.push(Buffer.from([ESC, 0x4d])); // ESC M - elite (12 cpi)
    }

    // Print text (encode as Big5 for traditional Chinese dot-matrix printers)
    // For now, use UTF-8 / ASCII. Real implementation would need iconv-lite for Big5.
    parts.push(Buffer.from(field.text, 'utf-8'));

    // Reset condensed mode if set
    if (field.fontSize === 'condensed') {
      parts.push(Buffer.from([0x12])); // DC2 - cancel condensed
    }

    // Reset print mode
    parts.push(Buffer.from([ESC, 0x21, 0x00]));

    // Line feed after text
    parts.push(Buffer.from([LF]));
    currentY += 30; // ~1 line = 30/180 inch
  }

  // Form feed at end (eject page)
  if (doc.formFeed !== false) {
    parts.push(Buffer.from([FF]));
  }

  return Buffer.concat(parts);
}

/** Send ESC/P buffer to a printer via TCP socket (RAW port 9100) */
export async function sendEscpToTcp(
  buffer: Buffer,
  host: string,
  port = 9100
): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error(`TCP connection to ${host}:${port} timed out`));
    }, 10_000);

    client.connect(port, host, () => {
      logger.info({ host, port, bytes: buffer.length }, 'Sending ESC/P data via TCP');
      client.write(buffer, (err) => {
        clearTimeout(timeout);
        if (err) {
          client.destroy();
          reject(err);
        } else {
          client.end();
          resolve();
        }
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    client.on('close', () => {
      clearTimeout(timeout);
    });
  });
}

/** Send ESC/P buffer to a Windows shared printer via raw write */
export async function sendEscpToWindowsPrinter(
  buffer: Buffer,
  printerShare: string
): Promise<void> {
  // On Windows, use: copy /b file.prn \\server\printer
  // Or use net use LPT1: \\server\printer
  // For local USB printers, use the Windows API through child_process
  const { exec } = await import('child_process');
  const fs = await import('fs');
  const path = await import('path');
  const { config } = await import('../config');

  const tmpFile = path.join(config.outputDir, `escp-${Date.now()}.prn`);
  fs.writeFileSync(tmpFile, buffer);

  return new Promise((resolve, reject) => {
    // Use Windows COPY /B to send raw data to printer
    const cmd = `copy /b "${tmpFile.replace(/\//g, '\\')}" "${printerShare}"`;
    exec(cmd, { shell: 'cmd.exe' }, (error) => {
      // Clean up temp file
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

      if (error) {
        logger.error({ error, printerShare }, 'Failed to send ESC/P to printer');
        reject(new Error(`ESC/P print failed: ${error.message}`));
      } else {
        logger.info({ printerShare }, 'ESC/P data sent to printer');
        resolve();
      }
    });
  });
}
