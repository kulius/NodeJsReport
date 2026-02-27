import net from 'net';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import iconv from 'iconv-lite';
import { logger } from '../utils/logger';
import { config } from '../config';
import { renderLine, type FontSize, FONT_NORMAL } from './bitmap-font.service';

/**
 * ESC/P Command Builder for dot-matrix printers (e.g., EPSON LQ series).
 *
 * Reference: Epson ESC/P Reference Manual
 * - ESC @ : Initialize printer
 * - ESC $ nL nH : Set absolute horizontal position
 * - ESC J n : Advance paper n/180 inches
 * - ESC ! n : Select print mode (bold, double-width, etc.)
 * - ESC 3 n : Set line spacing to n/180 inches
 * - ESC C n : Set page length to n lines
 * - FS & : Select Chinese character mode (Big5)
 * - FS . : Cancel Chinese character mode
 * - FF : Form Feed
 */

/** ESC/P control codes */
const ESC = 0x1b;
const FS = 0x1c;    // File Separator (used for Chinese commands)
const FF = 0x0c;    // Form Feed
const CR = 0x0d;    // Carriage Return
const LF = 0x0a;    // Line Feed
const SI = 0x0f;    // Condensed mode ON
const DC2 = 0x12;   // Condensed mode OFF

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

// ── ESC/P2 Command Helpers ──

/** Initialize printer: ESC @ */
export function cmdInit(): Buffer {
  return Buffer.from([ESC, 0x40]);
}

/** Enable Chinese character mode (Big5): FS & */
export function cmdChineseOn(): Buffer {
  return Buffer.from([FS, 0x26]);
}

/** Cancel Chinese character mode: FS . */
export function cmdChineseOff(): Buffer {
  return Buffer.from([FS, 0x2e]);
}

/**
 * Set page length in lines: ESC C n
 * n = number of lines per page (1-127), based on current line spacing.
 * e.g., at 1/8" line spacing (24/180), 44 lines ≈ 5.5" (140mm 中一刀)
 */
export function cmdPageLength(lines: number): Buffer {
  const n = Math.min(Math.max(lines, 1), 127);
  return Buffer.from([ESC, 0x43, n]);
}

/** Set line spacing to n/180 inches: ESC 3 n */
export function cmdLineSpacing(n: number): Buffer {
  return Buffer.from([ESC, 0x33, Math.min(Math.max(n, 0), 255)]);
}

/** Reset line spacing to 1/6 inch (default): ESC 2 */
export function cmdLineSpacingDefault(): Buffer {
  return Buffer.from([ESC, 0x32]);
}

/** Bold ON: ESC E */
export function cmdBoldOn(): Buffer {
  return Buffer.from([ESC, 0x45]);
}

/** Bold OFF: ESC F */
export function cmdBoldOff(): Buffer {
  return Buffer.from([ESC, 0x46]);
}

/** Double-width ON: ESC W 1 */
export function cmdDoubleWidthOn(): Buffer {
  return Buffer.from([ESC, 0x57, 0x01]);
}

/** Double-width OFF: ESC W 0 */
export function cmdDoubleWidthOff(): Buffer {
  return Buffer.from([ESC, 0x57, 0x00]);
}

/** Condensed mode ON: SI */
export function cmdCondensedOn(): Buffer {
  return Buffer.from([SI]);
}

/** Condensed mode OFF: DC2 */
export function cmdCondensedOff(): Buffer {
  return Buffer.from([DC2]);
}

/** Elite mode (12 CPI): ESC M */
export function cmdEliteOn(): Buffer {
  return Buffer.from([ESC, 0x4d]);
}

/** Pica mode (10 CPI, default): ESC P */
export function cmdPicaOn(): Buffer {
  return Buffer.from([ESC, 0x50]);
}

/** Carriage return + line feed */
export function cmdCRLF(): Buffer {
  return Buffer.from([CR, LF]);
}

/** Carriage return only */
export function cmdCR(): Buffer {
  return Buffer.from([CR]);
}

/** Form Feed */
export function cmdFF(): Buffer {
  return Buffer.from([FF]);
}

/** Set absolute horizontal position: ESC $ nL nH (units: 1/60 inch) */
export function cmdHorizontalPosition(pos: number): Buffer {
  const nL = pos & 0xff;
  const nH = (pos >> 8) & 0xff;
  return Buffer.from([ESC, 0x24, nL, nH]);
}

/** Advance paper n/180 inches: ESC J n */
export function cmdAdvancePaper(n: number): Buffer {
  const parts: Buffer[] = [];
  let remaining = n;
  while (remaining > 0) {
    const advance = Math.min(remaining, 255);
    parts.push(Buffer.from([ESC, 0x4a, advance]));
    remaining -= advance;
  }
  return Buffer.concat(parts);
}

/** Encode text to Big5 for Chinese dot-matrix printers */
export function encodeBig5(text: string): Buffer {
  return iconv.encode(text, 'big5');
}

/** Encode text - uses Big5 for Chinese characters, ASCII for pure ASCII */
export function encodeText(text: string): Buffer {
  return encodeBig5(text);
}

/**
 * Calculate display width of text in half-width character units.
 * ASCII = 1, CJK = 2
 */
export function textWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    // CJK ranges: basic CJK, CJK Extension A/B, CJK Compatibility
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0x20000 && code <= 0x2fa1f) ||
      (code >= 0xff00 && code <= 0xff60) ||  // fullwidth forms
      (code >= 0xffe0 && code <= 0xffe6)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Pad or truncate text to exact display width (half-width units).
 * Pads with spaces on the right by default.
 */
export function padText(text: string, targetWidth: number, align: 'left' | 'right' | 'center' = 'left'): string {
  const w = textWidth(text);
  if (w >= targetWidth) {
    // Truncate
    let result = '';
    let current = 0;
    for (const char of text) {
      const cw = textWidth(char);
      if (current + cw > targetWidth) break;
      result += char;
      current += cw;
    }
    // Fill remaining with spaces if truncation left space
    const remaining = targetWidth - textWidth(result);
    return result + ' '.repeat(remaining);
  }

  const padding = targetWidth - w;
  if (align === 'right') {
    return ' '.repeat(padding) + text;
  }
  if (align === 'center') {
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return ' '.repeat(left) + text + ' '.repeat(right);
  }
  return text + ' '.repeat(padding);
}

/**
 * Build a line of text from columns with specified widths.
 * Each column: { text, width, align }
 */
export function buildLine(
  columns: ReadonlyArray<{ readonly text: string; readonly width: number; readonly align?: 'left' | 'right' | 'center' }>
): string {
  return columns.map(col => padText(col.text, col.width, col.align ?? 'left')).join('');
}

/**
 * Draw a horizontal separator line using dashes.
 * totalWidth in half-width character units.
 */
export function drawSeparator(totalWidth: number, char = '-'): string {
  return char.repeat(totalWidth);
}

/** Build ESC/P command buffer for a document (legacy field-based API) */
export function buildEscpBuffer(doc: EscpDocument): Buffer {
  const parts: Buffer[] = [];

  // Initialize printer
  parts.push(cmdInit());

  // Sort fields by Y position for sequential printing
  const sortedFields = [...doc.fields].sort((a, b) => a.y - b.y);

  let currentY = 0;

  for (const field of sortedFields) {
    // Vertical positioning: advance from current position
    const yAdvance = field.y - currentY;
    if (yAdvance > 0) {
      parts.push(cmdAdvancePaper(yAdvance));
      currentY = field.y;
    }

    // Carriage return before horizontal positioning
    parts.push(cmdCR());

    // Horizontal positioning: ESC $ nL nH
    parts.push(cmdHorizontalPosition(field.x));

    // Set print mode
    let printMode = 0;
    if (field.bold) printMode |= 0x08;
    if (field.doubleWidth) printMode |= 0x20;
    parts.push(Buffer.from([ESC, 0x21, printMode]));

    // Font size
    if (field.fontSize === 'condensed') {
      parts.push(cmdCondensedOn());
    } else if (field.fontSize === 'elite') {
      parts.push(cmdEliteOn());
    }

    // Print text (encode as Big5 for Chinese)
    parts.push(encodeText(field.text));

    // Reset condensed mode if set
    if (field.fontSize === 'condensed') {
      parts.push(cmdCondensedOff());
    }

    // Reset print mode
    parts.push(Buffer.from([ESC, 0x21, 0x00]));

    // Line feed after text
    parts.push(Buffer.from([LF]));
    currentY += 30; // ~1 line = 30/180 inch
  }

  // Form feed at end (eject page)
  if (doc.formFeed !== false) {
    parts.push(cmdFF());
  }

  return Buffer.concat(parts);
}

/**
 * Build ESC/P buffer from raw text lines.
 * This is the preferred API for report formats - just build lines of text
 * and let this function handle encoding + line spacing.
 *
 * Chinese mode: FS & enables Big5 Chinese character mode on LQ-690CIIN.
 * Must be sent after ESC @ (init) since init resets to ASCII mode.
 */
export function buildEscpFromLines(options: {
  readonly lines: readonly string[];
  readonly lineSpacing?: number;  // n/180 inch, default 24 (1/8")
  readonly condensed?: boolean;   // default false (pica 10 CPI)
  readonly formFeed?: boolean;    // default true
  readonly initPrinter?: boolean; // default true
  readonly enableChinese?: boolean; // default true (FS & for Big5)
  readonly pageLines?: number;    // page length in lines (ESC C n), 0 = don't set
}): Buffer {
  const {
    lines,
    lineSpacing = 24,
    condensed = false,
    formFeed = true,
    initPrinter = true,
    enableChinese = true,
    pageLines = 0,
  } = options;

  const parts: Buffer[] = [];

  if (initPrinter) {
    parts.push(cmdInit());
  }

  // Enable Chinese mode AFTER init (ESC @ resets to ASCII)
  if (enableChinese) {
    parts.push(cmdChineseOn());
  }

  // Set line spacing (must be before page length)
  parts.push(cmdLineSpacing(lineSpacing));

  // Set page length after line spacing so it uses correct line height
  if (pageLines > 0) {
    parts.push(cmdPageLength(pageLines));
  }

  if (condensed) {
    parts.push(cmdCondensedOn());
  }

  for (const line of lines) {
    parts.push(encodeText(line));
    parts.push(cmdCRLF());
  }

  if (condensed) {
    parts.push(cmdCondensedOff());
  }

  if (enableChinese) {
    parts.push(cmdChineseOff());
  }

  if (formFeed) {
    parts.push(cmdFF());
  }

  return Buffer.concat(parts);
}

/**
 * 24-pin graphics command: ESC * m nL nH d1...dk
 * m=39: 24-pin triple density (180 DPI horizontal)
 *       配合 24/180" 行距 (180 DPI vertical)，像素為正方形
 * nL, nH: number of columns (little-endian)
 * d1...dk: column data, 3 bytes per column (24 pins, MSB = pin 1)
 */
export function cmdGraphics24(columnData: Buffer): Buffer {
  if (columnData.length % 3 !== 0) {
    throw new Error(`Graphics column data must be a multiple of 3 bytes, got ${columnData.length}`);
  }
  const numColumns = columnData.length / 3;
  if (numColumns > 65535) {
    throw new Error(`Graphics column count ${numColumns} exceeds 16-bit limit`);
  }
  const nL = numColumns & 0xff;
  const nH = (numColumns >> 8) & 0xff;
  const header = Buffer.from([ESC, 0x2a, 39, nL, nH]); // ESC * 39 nL nH (180 DPI)
  return Buffer.concat([header, columnData]);
}

/** A line entry: plain string (FONT_NORMAL) or object with fontSize */
export type LineEntry = string | { readonly text: string; readonly fontSize: FontSize };

/**
 * Build ESC/P buffer from text lines using 24-pin bitmap graphics mode.
 *
 * Instead of sending text + FS & Chinese mode (which many printers don't support),
 * this renders all text (ASCII + CJK) as bitmaps via opentype.js and outputs
 * ESC * 33 graphic commands. Works with any 24-pin dot matrix printer.
 *
 * Line spacing is set to 24/180" so 24-pin graphics rows tile seamlessly.
 *
 * Supports per-line font size via LineEntry. Large fonts (charHeight > 24)
 * are automatically split into multiple 24-pin bands.
 */
export function buildEscpFromBitmapLines(options: {
  readonly lines: readonly LineEntry[];
  readonly formFeed?: boolean;    // default true
  readonly initPrinter?: boolean; // default true
  readonly pageLines?: number;    // page length in lines (ESC C n), 0 = don't set
}): Buffer {
  const {
    lines,
    formFeed = true,
    initPrinter = true,
    pageLines = 0,
  } = options;

  const parts: Buffer[] = [];

  if (initPrinter) {
    parts.push(cmdInit());
  }

  // Set line spacing to 24/180" — exactly 24 pins, no gap between graphic rows
  parts.push(cmdLineSpacing(24));

  // Set page length after line spacing so it uses correct line height
  if (pageLines > 0) {
    parts.push(cmdPageLength(pageLines));
  }

  for (const entry of lines) {
    const lineText = typeof entry === 'string' ? entry : entry.text;
    const fontSize = typeof entry === 'string' ? FONT_NORMAL : entry.fontSize;

    if (!lineText || lineText.trim().length === 0) {
      // Empty line: just CR+LF (advances by line spacing)
      parts.push(cmdCRLF());
      continue;
    }

    // Render the line text into bitmap column data
    const rendered = renderLine(lineText, fontSize);

    if (rendered.width > 0) {
      // Output each 24-pin band
      for (let b = 0; b < rendered.bandCount; b++) {
        parts.push(cmdCR());
        parts.push(cmdGraphics24(rendered.bands[b]));
        parts.push(cmdCRLF());
      }
    } else {
      parts.push(cmdCRLF());
    }
  }

  if (formFeed) {
    parts.push(cmdFF());
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

/**
 * Validate printer name to prevent command injection.
 * Only allows alphanumeric, spaces, hyphens, underscores, dots, slashes, and parentheses.
 */
function validatePrinterName(name: string): void {
  if (!name || name.length > 256) {
    throw new Error('Printer name must be 1-256 characters');
  }
  if (!/^[a-zA-Z0-9\s\-_./\\()]+$/.test(name)) {
    throw new Error('Printer name contains invalid characters');
  }
}

/**
 * Send ESC/P buffer to a local Windows printer via PowerShell RawPrinterHelper.
 * Uses .NET P/Invoke to send raw bytes directly to the printer driver,
 * bypassing the GDI print pipeline. Works with local USB printers.
 *
 * Security: printer name and file path are passed via environment variables
 * to prevent PowerShell command injection.
 */
export async function sendEscpToLocalPrinter(
  buffer: Buffer,
  printerName: string
): Promise<void> {
  validatePrinterName(printerName);

  const tmpFile = path.join(config.outputDir, `escp-${randomUUID()}.prn`);
  fs.writeFileSync(tmpFile, buffer);

  // PowerShell script reads printer name and file path from env vars (no injection risk)
  const psScript = `
$signature = @'
[DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

[DllImport("winspool.drv", SetLastError=true)]
public static extern bool ClosePrinter(IntPtr hPrinter);

[DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern bool StartDocPrinter(IntPtr hPrinter, int Level, ref DOCINFOA pDocInfo);

[DllImport("winspool.drv", SetLastError=true)]
public static extern bool EndDocPrinter(IntPtr hPrinter);

[DllImport("winspool.drv", SetLastError=true)]
public static extern bool StartPagePrinter(IntPtr hPrinter);

[DllImport("winspool.drv", SetLastError=true)]
public static extern bool EndPagePrinter(IntPtr hPrinter);

[DllImport("winspool.drv", SetLastError=true)]
public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct DOCINFOA {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
}
'@

Add-Type -MemberDefinition $signature -Name RawPrinter -Namespace Win32 -PassThru | Out-Null

function Send-RawData($printerName, $filePath) {
    $hPrinter = [IntPtr]::Zero
    if (-not [Win32.RawPrinter]::OpenPrinter($printerName, [ref]$hPrinter, [IntPtr]::Zero)) {
        throw "Cannot open printer: $printerName"
    }
    try {
        $di = New-Object Win32.RawPrinter+DOCINFOA
        $di.pDocName = "ESC/P Raw Print"
        $di.pOutputFile = $null
        $di.pDataType = "RAW"

        if (-not [Win32.RawPrinter]::StartDocPrinter($hPrinter, 1, [ref]$di)) {
            throw "StartDocPrinter failed"
        }
        try {
            if (-not [Win32.RawPrinter]::StartPagePrinter($hPrinter)) {
                throw "StartPagePrinter failed"
            }
            try {
                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                $ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
                try {
                    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
                    $written = 0
                    if (-not [Win32.RawPrinter]::WritePrinter($hPrinter, $ptr, $bytes.Length, [ref]$written)) {
                        throw "WritePrinter failed"
                    }
                } finally {
                    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
                }
            } finally {
                [Win32.RawPrinter]::EndPagePrinter($hPrinter) | Out-Null
            }
        } finally {
            [Win32.RawPrinter]::EndDocPrinter($hPrinter) | Out-Null
        }
    } finally {
        [Win32.RawPrinter]::ClosePrinter($hPrinter) | Out-Null
    }
}

Send-RawData $env:ESCP_PRINTER $env:ESCP_FILE
`;

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      {
        timeout: 30_000,
        env: { ...process.env, ESCP_PRINTER: printerName, ESCP_FILE: tmpFile },
      },
      (error, _stdout, stderr) => {
        // Clean up temp file
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

        if (error) {
          logger.error({ error, stderr, printerName }, 'Failed to send ESC/P via RawPrinterHelper');
          reject(new Error(`ESC/P raw print failed: ${stderr || error.message}`));
        } else {
          logger.info({ printerName, bytes: buffer.length }, 'ESC/P data sent via RawPrinterHelper');
          resolve();
        }
      }
    );
  });
}

/** Send ESC/P buffer to a Windows shared printer via copy /b */
export async function sendEscpToWindowsPrinter(
  buffer: Buffer,
  printerShare: string
): Promise<void> {
  // Validate: must look like \\server\printer
  if (!/^\\\\[a-zA-Z0-9._-]+\\[a-zA-Z0-9._\s-]+$/.test(printerShare)) {
    throw new Error('Invalid printer share path format. Expected \\\\server\\printer');
  }

  const tmpFile = path.join(config.outputDir, `escp-${randomUUID()}.prn`);
  fs.writeFileSync(tmpFile, buffer);

  return new Promise((resolve, reject) => {
    // Use Windows COPY /B to send raw data to printer
    // execFile with explicit args avoids shell injection
    execFile(
      'cmd.exe',
      ['/c', 'copy', '/b', tmpFile.replace(/\//g, '\\'), printerShare],
      { timeout: 30_000 },
      (error) => {
        // Clean up temp file
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

        if (error) {
          logger.error({ error, printerShare }, 'Failed to send ESC/P to printer');
          reject(new Error(`ESC/P print failed: ${error.message}`));
        } else {
          logger.info({ printerShare }, 'ESC/P data sent to printer');
          resolve();
        }
      }
    );
  });
}
