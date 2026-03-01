/**
 * Bitmap Preview Service — renders ESC/P RenderedLine[] to PNG image.
 *
 * Decodes 24-pin column data (3 bytes/column) back into pixel matrix
 * and composes a full-page PNG. This is pixel-perfect with printer output.
 */

import { PNG } from 'pngjs';
import type { RenderedLine } from './bitmap-font.service';

/** Line spacing in pixels (matching ESC/P 24/180" = 24 pins) */
const LINE_SPACING = 24;

/**
 * Convert RenderedLine[] to a PNG buffer.
 *
 * Each RenderedLine contains bands of 24-pin column data.
 * We decode each band's columns (3 bytes = 24 pins per column)
 * into a pixel matrix and compose them vertically.
 */
export function renderedLinesToPng(
  lines: readonly RenderedLine[],
  lineSpacing = LINE_SPACING,
): Buffer {
  // 1. Calculate total image dimensions
  let totalHeight = 0;
  let maxWidth = 0;

  for (const line of lines) {
    if (line.width === 0) {
      // Empty line: just line spacing
      totalHeight += lineSpacing;
    } else {
      totalHeight += line.bandCount * lineSpacing;
    }
    if (line.width > maxWidth) {
      maxWidth = line.width;
    }
  }

  // Ensure minimum dimensions
  if (maxWidth === 0) maxWidth = 1;
  if (totalHeight === 0) totalHeight = 1;

  // 2. Create PNG canvas (white background)
  const png = new PNG({ width: maxWidth, height: totalHeight });

  // Fill white
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 255;     // R
    png.data[i + 1] = 255; // G
    png.data[i + 2] = 255; // B
    png.data[i + 3] = 255; // A
  }

  // 3. Decode each line's bands into pixels
  let yOffset = 0;

  for (const line of lines) {
    if (line.width === 0) {
      yOffset += lineSpacing;
      continue;
    }

    for (let b = 0; b < line.bandCount; b++) {
      const bandData = line.bands[b];
      const numColumns = bandData.length / 3;

      for (let col = 0; col < numColumns; col++) {
        // 3 bytes per column = 24 pins (MSB of byte 0 = pin 1 = top)
        const byte0 = bandData[col * 3];
        const byte1 = bandData[col * 3 + 1];
        const byte2 = bandData[col * 3 + 2];

        // Decode 24 pins
        for (let pin = 0; pin < 24; pin++) {
          let bit: number;
          if (pin < 8) {
            bit = (byte0 >> (7 - pin)) & 1;
          } else if (pin < 16) {
            bit = (byte1 >> (7 - (pin - 8))) & 1;
          } else {
            bit = (byte2 >> (7 - (pin - 16))) & 1;
          }

          if (bit) {
            const x = col;
            const y = yOffset + b * lineSpacing + pin;

            if (x < maxWidth && y < totalHeight) {
              const idx = (y * maxWidth + x) * 4;
              png.data[idx] = 0;       // R = black
              png.data[idx + 1] = 0;   // G
              png.data[idx + 2] = 0;   // B
              // A stays 255
            }
          }
        }
      }

      yOffset += lineSpacing;
    }
  }

  // 4. Encode to PNG buffer
  return PNG.sync.write(png);
}
