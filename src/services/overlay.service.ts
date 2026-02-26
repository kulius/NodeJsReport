import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';
import { getTemplate } from './template.service';
import { getPaperSizeInPt } from './paper-size.service';
import type { OverlayTemplate, TemplateField } from '../models/template.model';

interface OverlayOptions {
  readonly templateId: string;
  readonly data: Record<string, unknown>;
  readonly showBackground: boolean;
}

/** Generate an overlay PDF using pdf-lib */
export async function generateOverlay(options: OverlayOptions): Promise<Buffer> {
  const { templateId, data, showBackground } = options;

  const template = getTemplate(templateId);
  if (!template) {
    throw new Error(`Template '${templateId}' not found`);
  }

  logger.info({ templateId, showBackground }, 'Generating overlay PDF');

  let pdfDoc: PDFDocument;

  // Load background PDF or create blank
  if (showBackground && template.backgroundPdf) {
    const bgPath = path.join(config.uploadsDir, template.backgroundPdf);
    if (fs.existsSync(bgPath)) {
      const bgBytes = fs.readFileSync(bgPath);
      pdfDoc = await PDFDocument.load(bgBytes);
    } else {
      logger.warn({ bgPath }, 'Background PDF not found, creating blank');
      pdfDoc = await PDFDocument.create();
      addBlankPage(pdfDoc, template);
    }
  } else {
    pdfDoc = await PDFDocument.create();
    addBlankPage(pdfDoc, template);
  }

  const page = pdfDoc.getPage(0);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Try to embed CJK font if available
  let cjkFont = font;
  let cjkFontBold = fontBold;
  const notoPath = path.join(config.fontDir, 'NotoSansTC-Regular.ttf');
  const notoBoldPath = path.join(config.fontDir, 'NotoSansTC-Bold.ttf');

  if (fs.existsSync(notoPath)) {
    try {
      const notoBytes = fs.readFileSync(notoPath);
      cjkFont = await pdfDoc.embedFont(notoBytes);
      if (fs.existsSync(notoBoldPath)) {
        const notoBoldBytes = fs.readFileSync(notoBoldPath);
        cjkFontBold = await pdfDoc.embedFont(notoBoldBytes);
      } else {
        cjkFontBold = cjkFont;
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to embed CJK font, using Helvetica');
    }
  }

  // Draw fields
  for (const field of template.fields) {
    const value = data[field.name];
    if (value === undefined || value === null) continue;

    if (field.type === 'text') {
      drawTextField(page, field, String(value), {
        font: field.bold ? cjkFontBold : cjkFont,
        fontSize: field.fontSize || template.defaultFont.size,
      });
    } else if (field.type === 'table' && Array.isArray(value)) {
      drawTableField(page, field, value as Record<string, unknown>[], {
        font: cjkFont,
        fontBold: cjkFontBold,
        fontSize: field.fontSize || template.defaultFont.size,
      });
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

function addBlankPage(pdfDoc: PDFDocument, template: OverlayTemplate): void {
  const dims = getPaperSizeInPt(template.paperSize) || { width: 595.28, height: 841.89 };
  pdfDoc.addPage([dims.width, dims.height]);
}

function drawTextField(
  page: any,
  field: TemplateField,
  text: string,
  opts: { font: any; fontSize: number }
): void {
  const drawOpts: any = {
    x: field.x,
    y: field.y,
    size: opts.fontSize,
    font: opts.font,
    color: rgb(0, 0, 0),
  };

  if (field.maxWidth) {
    drawOpts.maxWidth = field.maxWidth;
  }

  // Handle letter spacing by drawing characters individually
  if (field.letterSpacing && field.letterSpacing > 0) {
    let xPos = field.x;
    for (const char of text) {
      page.drawText(char, { ...drawOpts, x: xPos });
      xPos += opts.font.widthOfTextAtSize(char, opts.fontSize) + field.letterSpacing;
    }
  } else {
    page.drawText(text, drawOpts);
  }
}

function drawTableField(
  page: any,
  field: TemplateField,
  rows: Record<string, unknown>[],
  opts: { font: any; fontBold: any; fontSize: number }
): void {
  if (!field.columns) return;

  const rowHeight = field.rowHeight || 16;
  const maxRows = field.maxRows || rows.length;
  const displayRows = rows.slice(0, maxRows);

  displayRows.forEach((row, rowIndex) => {
    let xOffset = field.x;
    const yPos = field.y - rowIndex * rowHeight;

    for (const col of field.columns!) {
      const cellValue = String(row[col.field] ?? '');
      let cellX = xOffset;

      // Handle alignment
      if (col.align === 'right') {
        const textWidth = opts.font.widthOfTextAtSize(cellValue, opts.fontSize);
        cellX = xOffset + col.width - textWidth;
      } else if (col.align === 'center') {
        const textWidth = opts.font.widthOfTextAtSize(cellValue, opts.fontSize);
        cellX = xOffset + (col.width - textWidth) / 2;
      }

      page.drawText(cellValue, {
        x: cellX,
        y: yPos,
        size: opts.fontSize,
        font: opts.font,
        color: rgb(0, 0, 0),
      });

      xOffset += col.width;
    }
  });
}
