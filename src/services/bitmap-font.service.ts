/**
 * Bitmap Font Service — renders text to 24-pin dot bitmaps for ESC/P graphic mode.
 *
 * Uses opentype.js (pure JS, no native deps, pkg-compatible) to load TTF fonts,
 * extract glyph outlines, and rasterize them into bitmaps via a scanline fill algorithm.
 *
 * Output format: ESC/P 24-pin column data (3 bytes per column, MSB = pin 1).
 */

import path from 'path';
import opentype from 'opentype.js';
import { config } from '../config';
import { logger } from '../utils/logger';

// ── Types ──

/** Font size specification for variable-size bitmap rendering */
export interface FontSize {
  readonly charHeight: number;
  readonly asciiWidth: number;
  readonly cjkWidth: number;
}

/** Normal size: 24px height, 12/24px widths (default, backward compatible) */
export const FONT_NORMAL: FontSize = { charHeight: 24, asciiWidth: 12, cjkWidth: 24 };

/** Small size: 20px height, 10/20px widths (compact content) */
export const FONT_SMALL: FontSize = { charHeight: 20, asciiWidth: 10, cjkWidth: 20 };

/** Large size: 48px height, 24/48px widths (titles, requires multi-band) */
export const FONT_LARGE: FontSize = { charHeight: 48, asciiWidth: 24, cjkWidth: 48 };

interface GlyphBitmap {
  readonly width: number;   // pixels wide
  readonly height: number;  // pixels tall
  readonly data: Uint8Array; // row-major, 1 byte per pixel (0 or 1)
}

export interface RenderedLine {
  readonly width: number;     // total dots wide
  readonly columns: Buffer;   // ESC/P column data: 3 bytes per column (per band)
  readonly bandCount: number; // number of 24-pin bands (1 for normal/small, 2+ for large)
  readonly bands: readonly Buffer[]; // column data for each band
}

// ── Constants ──

/** Pin height for 24-pin dot matrix */
const CHAR_HEIGHT = 24;

/** Default character widths in pixels at 120 DPI */
const CJK_CHAR_WIDTH = 24;
const ASCII_CHAR_WIDTH = 12;

/** Number of line segments to approximate a bezier curve */
const BEZIER_STEPS = 12;

// ── Font Management ──

let cachedFont: opentype.Font | null = null;

function getFont(): opentype.Font {
  if (cachedFont) return cachedFont;

  const fontPath = path.join(config.fontDir, 'NotoSansTC-Regular.ttf');
  try {
    cachedFont = opentype.loadSync(fontPath);
    const os2 = (cachedFont as any).tables?.os2;
    logger.info({
      fontPath,
      unitsPerEm: cachedFont.unitsPerEm,
      ascender: cachedFont.ascender,
      descender: cachedFont.descender,
      sTypoAscender: os2?.sTypoAscender,
      sTypoDescender: os2?.sTypoDescender,
    }, 'Loaded bitmap font');
    return cachedFont;
  } catch (err) {
    logger.error({ err, fontPath }, 'Failed to load bitmap font');
    throw new Error(`Cannot load font: ${fontPath}`);
  }
}

// ── Glyph Bitmap Cache ──

const MAX_CACHE_SIZE = 4096;
const glyphCache = new Map<string, GlyphBitmap>();

function cacheGlyph(key: string, bitmap: GlyphBitmap): void {
  if (glyphCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entry (FIFO)
    const firstKey = glyphCache.keys().next().value;
    if (firstKey !== undefined) glyphCache.delete(firstKey);
  }
  glyphCache.set(key, bitmap);
}

/** Clear the glyph cache (useful for testing or font reload) */
export function clearGlyphCache(): void {
  glyphCache.clear();
}

// ── Scanline Rasterizer ──

/**
 * Check if a character is CJK (full-width).
 */
function isCJK(code: number): boolean {
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0x20000 && code <= 0x2fa1f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

/**
 * Flatten a quadratic bezier curve (M/L/Q) into line segments.
 */
function flattenQuadratic(
  x0: number, y0: number,
  cx: number, cy: number,
  x1: number, y1: number,
  segments: Array<[number, number]>,
): void {
  for (let i = 1; i <= BEZIER_STEPS; i++) {
    const t = i / BEZIER_STEPS;
    const mt = 1 - t;
    const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
    const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
    segments.push([x, y]);
  }
}

/**
 * Flatten a cubic bezier curve into line segments.
 */
function flattenCubic(
  x0: number, y0: number,
  cx1: number, cy1: number,
  cx2: number, cy2: number,
  x1: number, y1: number,
  segments: Array<[number, number]>,
): void {
  for (let i = 1; i <= BEZIER_STEPS; i++) {
    const t = i / BEZIER_STEPS;
    const mt = 1 - t;
    const x = mt * mt * mt * x0 + 3 * mt * mt * t * cx1 + 3 * mt * t * t * cx2 + t * t * t * x1;
    const y = mt * mt * mt * y0 + 3 * mt * mt * t * cy1 + 3 * mt * t * t * cy2 + t * t * t * y1;
    segments.push([x, y]);
  }
}

/**
 * Convert opentype.js path commands into a list of polygon edges (line segments).
 * Returns array of polygons, each polygon is an array of [x, y] points.
 */
function pathToPolygons(commands: opentype.PathCommand[]): Array<Array<[number, number]>> {
  const polygons: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  let cx = 0;
  let cy = 0;

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        if (current.length > 0) {
          polygons.push(current);
        }
        current = [[cmd.x!, cmd.y!]];
        cx = cmd.x!;
        cy = cmd.y!;
        break;
      case 'L':
        current.push([cmd.x!, cmd.y!]);
        cx = cmd.x!;
        cy = cmd.y!;
        break;
      case 'Q':
        flattenQuadratic(cx, cy, cmd.x1!, cmd.y1!, cmd.x!, cmd.y!, current);
        cx = cmd.x!;
        cy = cmd.y!;
        break;
      case 'C':
        flattenCubic(cx, cy, cmd.x1!, cmd.y1!, cmd.x2!, cmd.y2!, cmd.x!, cmd.y!, current);
        cx = cmd.x!;
        cy = cmd.y!;
        break;
      case 'Z':
        if (current.length > 0) {
          polygons.push(current);
          current = [];
        }
        break;
    }
  }

  if (current.length > 0) {
    polygons.push(current);
  }

  return polygons;
}

/**
 * Scanline fill: rasterize polygons into a bitmap using non-zero winding rule
 * with supersampling for thin stroke preservation.
 *
 * Non-zero winding is required for TrueType/OpenType fonts where overlapping
 * contours are common (e.g. CJK characters). Even-odd would create holes.
 *
 * Supersampling renders at SS× resolution then downsamples with OR rule:
 * if any sub-pixel in an SS×SS block is filled, the output pixel is 1.
 * This prevents thin strokes (< 1px) from disappearing between scanlines.
 */
function scanlineFill(
  polygons: Array<Array<[number, number]>>,
  width: number,
  height: number,
  supersample: number = 3,
): Uint8Array {
  const ss = supersample;
  const ssW = width * ss;
  const ssH = height * ss;
  const ssBitmap = new Uint8Array(ssW * ssH);

  // Scale polygons to supersample resolution
  const ssPolygons = polygons.map(poly =>
    poly.map(([x, y]): [number, number] => [x * ss, y * ss])
  );

  // Collect all edges with winding direction from all polygons
  const edges: Array<{ x0: number; y0: number; x1: number; y1: number; dir: 1 | -1 }> = [];
  for (const poly of ssPolygons) {
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i];
      const p1 = poly[(i + 1) % poly.length];
      // Skip horizontal edges
      if (Math.abs(p0[1] - p1[1]) < 0.001) continue;
      // Direction: +1 if edge goes downward (y0 < y1), -1 if upward
      const dir: 1 | -1 = p0[1] < p1[1] ? 1 : -1;
      edges.push({ x0: p0[0], y0: p0[1], x1: p1[0], y1: p1[1], dir });
    }
  }

  // For each scanline (row) at supersample resolution
  for (let y = 0; y < ssH; y++) {
    const scanY = y + 0.5; // Center of sub-pixel row
    const crossings: Array<{ x: number; dir: 1 | -1 }> = [];

    for (const edge of edges) {
      const { x0, y0, x1, y1, dir } = edge;
      // Check if scanline intersects this edge
      if ((y0 <= scanY && y1 > scanY) || (y1 <= scanY && y0 > scanY)) {
        // Calculate x intersection
        const t = (scanY - y0) / (y1 - y0);
        const ix = x0 + t * (x1 - x0);
        crossings.push({ x: ix, dir });
      }
    }

    // Sort crossings left to right
    crossings.sort((a, b) => a.x - b.x);

    // Fill using non-zero winding rule
    let winding = 0;
    for (let i = 0; i < crossings.length; i++) {
      winding += crossings[i].dir;
      // Fill between this crossing and the next if winding is non-zero
      if (winding !== 0 && i + 1 < crossings.length) {
        const xStart = Math.max(0, Math.ceil(crossings[i].x));
        const xEnd = Math.min(ssW - 1, Math.floor(crossings[i + 1].x));
        for (let x = xStart; x <= xEnd; x++) {
          ssBitmap[y * ssW + x] = 1;
        }
      }
    }
  }

  // Downsample: OR rule — any sub-pixel hit → output pixel = 1
  const bitmap = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      outer:
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          if (ssBitmap[(y * ss + sy) * ssW + (x * ss + sx)]) {
            bitmap[y * width + x] = 1;
            break outer;
          }
        }
      }
    }
  }

  return bitmap;
}

/**
 * Render a single character to a bitmap.
 */
export function renderChar(char: string, fontSize?: FontSize): GlyphBitmap {
  const fs = fontSize ?? FONT_NORMAL;
  const charHeight = fs.charHeight;
  const cacheKey = `${char}:${charHeight}:${fs.asciiWidth}:${fs.cjkWidth}`;
  const cached = glyphCache.get(cacheKey);
  if (cached) return cached;

  const font = getFont();
  const code = char.codePointAt(0) ?? 0;
  const targetWidth = isCJK(code) ? fs.cjkWidth : fs.asciiWidth;

  // Space character — empty bitmap
  if (char === ' ' || code <= 0x20) {
    const result: GlyphBitmap = {
      width: fs.asciiWidth,
      height: charHeight,
      data: new Uint8Array(fs.asciiWidth * charHeight),
    };
    cacheGlyph(cacheKey, result);
    return result;
  }

  const glyph = font.charToGlyph(char);

  // Calculate font size to fit within charHeight pixels
  // opentype.js uses font units; scale = charHeight / unitsPerEm
  const scale = charHeight / font.unitsPerEm;
  const otFontSize = charHeight; // opentype.js fontSize parameter

  // Get the glyph path at origin (0, 0)
  // opentype.js draws with y going up; we need y going down for bitmap
  // getPath(x, y, fontSize): x,y is the baseline position
  // Use OS/2 sTypoAscender instead of hhea ascender for CJK fonts:
  // hhea ascender includes diacritics space, causing CJK glyphs to be
  // pushed down and bottom strokes clipped in the small 24px bitmap.
  const os2 = (font as any).tables?.os2;
  const effectiveAscender = os2?.sTypoAscender ?? font.ascender;
  const ascenderPx = effectiveAscender * scale;
  const glyphPath = glyph.getPath(0, ascenderPx, otFontSize);

  // Convert path commands to polygons and rasterize
  const polygons = pathToPolygons(glyphPath.commands);

  // Scale glyph to fit target width
  // First, figure out the actual glyph width
  const advanceWidthPx = glyph.advanceWidth * scale;

  // Scale factor to fit targetWidth
  let scaleX = 1;
  let offsetX = 0;
  if (advanceWidthPx > 0) {
    scaleX = targetWidth / advanceWidthPx;
    // Center the glyph if it's narrower
    if (scaleX > 1) {
      scaleX = 1;
      offsetX = Math.floor((targetWidth - advanceWidthPx) / 2);
    }
  }

  // Apply horizontal scaling to polygons
  const scaledPolygons = polygons.map(poly =>
    poly.map(([x, y]): [number, number] => [x * scaleX + offsetX, y])
  );

  const bitmap = scanlineFill(scaledPolygons, targetWidth, charHeight);

  const result: GlyphBitmap = {
    width: targetWidth,
    height: charHeight,
    data: bitmap,
  };
  cacheGlyph(cacheKey, result);
  return result;
}

/**
 * Render a full line of text to ESC/P 24-pin column format.
 *
 * Each column is 3 bytes (24 pins), MSB = top pin.
 * For charHeight > 24, the bitmap is split into multiple 24-pin bands.
 */
export function renderLine(text: string, fontSize?: FontSize): RenderedLine {
  const fs = fontSize ?? FONT_NORMAL;

  if (!text || text.length === 0) {
    return { width: 0, columns: Buffer.alloc(0), bandCount: 1, bands: [Buffer.alloc(0)] };
  }

  // Render each character and collect bitmaps
  const bitmaps: GlyphBitmap[] = [];
  for (const char of text) {
    bitmaps.push(renderChar(char, fs));
  }

  // Calculate total width
  const totalWidth = bitmaps.reduce((sum, b) => sum + b.width, 0);

  // Number of 24-pin bands needed
  const bandCount = Math.ceil(fs.charHeight / CHAR_HEIGHT);
  const bands: Buffer[] = [];

  for (let band = 0; band < bandCount; band++) {
    const bandTop = band * CHAR_HEIGHT;
    const bandColumns = Buffer.alloc(totalWidth * 3);

    let colOffset = 0;
    for (const bmp of bitmaps) {
      for (let x = 0; x < bmp.width; x++) {
        const col = colOffset + x;
        for (let pin = 0; pin < 24; pin++) {
          const row = bandTop + pin;
          if (row < bmp.height && bmp.data[row * bmp.width + x]) {
            const byteIdx = Math.floor(pin / 8);
            const bitIdx = 7 - (pin % 8);
            bandColumns[col * 3 + byteIdx] |= (1 << bitIdx);
          }
        }
      }
      colOffset += bmp.width;
    }

    bands.push(bandColumns);
  }

  return { width: totalWidth, columns: bands[0], bandCount, bands };
}

/**
 * Pre-load the font (call at startup to fail fast if font is missing).
 */
export function preloadFont(): boolean {
  try {
    getFont();
    return true;
  } catch {
    return false;
  }
}
