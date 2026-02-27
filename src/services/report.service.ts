import PdfPrinter from 'pdfmake';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { logger } from '../utils/logger';
import { getPaperSizeInPt } from './paper-size.service';
import type { ReportDefinition } from '../models/report-definition.model';

/** Create a pdfmake printer with CJK font support */
function createPrinter(): PdfPrinter {
  const notoRegular = path.join(config.fontDir, 'NotoSansTC-Regular.ttf');
  const notoBold = path.join(config.fontDir, 'NotoSansTC-Bold.ttf');

  if (!fs.existsSync(notoRegular)) {
    throw new Error(
      '缺少 CJK 字型檔案。請將 NotoSansTC-Regular.ttf 放到 data/fonts/ 目錄，或重啟服務讓自動下載完成。'
    );
  }

  const boldFont = fs.existsSync(notoBold) ? notoBold : notoRegular;

  const fonts: Record<string, Record<string, string>> = {
    NotoSansTC: {
      normal: notoRegular,
      bold: boldFont,
      italics: notoRegular,
      bolditalics: boldFont,
    },
  };

  return new PdfPrinter(fonts);
}

/** Resolve page size from string ID or custom dimensions */
function resolvePageSize(
  pageSize: string | { width: number; height: number }
): { width: number; height: number } | string {
  if (typeof pageSize === 'object') {
    return pageSize;
  }

  // Try our custom registry first
  const custom = getPaperSizeInPt(pageSize);
  if (custom) {
    return custom;
  }

  // Fall back to pdfmake built-in names (A4, LETTER, etc.)
  return pageSize;
}

/** Generate a PDF from a report definition */
export async function generateReport(definition: ReportDefinition): Promise<Buffer> {
  logger.info({ pageSize: definition.pageSize }, 'Generating report PDF');

  const fontName = 'NotoSansTC';

  const docDefinition = {
    pageSize: resolvePageSize(definition.pageSize),
    pageMargins: definition.pageMargins || [40, 60, 40, 60],
    pageOrientation: definition.pageOrientation || 'portrait',
    header: definition.header,
    footer: definition.footer,
    content: definition.content,
    styles: definition.styles || {},
    defaultStyle: {
      font: fontName,
      fontSize: 10,
      ...(definition.defaultStyle || {}),
    },
  };

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const printer = createPrinter();
      const pdfDoc = printer.createPdfKitDocument(docDefinition as any);
      const chunks: Buffer[] = [];

      pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdfDoc.on('end', () => {
        logger.info('Report PDF generated');
        resolve(Buffer.concat(chunks));
      });
      pdfDoc.on('error', reject);
      pdfDoc.end();
    } catch (error) {
      reject(error);
    }
  });
}
