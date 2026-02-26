import ExcelJS from 'exceljs';
import PdfPrinter from 'pdfmake';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { logger } from '../utils/logger';
import { getPaperSizeInPt } from './paper-size.service';

/** Font setup for pdfmake with CJK support */
function createPrinter(): PdfPrinter {
  const notoRegular = path.join(config.fontDir, 'NotoSansTC-Regular.ttf');
  const notoBold = path.join(config.fontDir, 'NotoSansTC-Bold.ttf');

  // Fallback to Roboto if CJK font not available
  const hasNoto = fs.existsSync(notoRegular);

  const fonts: Record<string, Record<string, string>> = hasNoto
    ? {
        NotoSansTC: {
          normal: notoRegular,
          bold: notoBold || notoRegular,
          italics: notoRegular,
          bolditalics: notoBold || notoRegular,
        },
      }
    : {
        Roboto: {
          normal: path.join(__dirname, '..', '..', 'node_modules', 'pdfmake', 'build', 'vfs_fonts.js'),
          bold: path.join(__dirname, '..', '..', 'node_modules', 'pdfmake', 'build', 'vfs_fonts.js'),
          italics: path.join(__dirname, '..', '..', 'node_modules', 'pdfmake', 'build', 'vfs_fonts.js'),
          bolditalics: path.join(__dirname, '..', '..', 'node_modules', 'pdfmake', 'build', 'vfs_fonts.js'),
        },
      };

  return new PdfPrinter(fonts);
}

interface ExcelToPdfOptions {
  readonly paperSize?: string;
  readonly fitToPageWidth?: boolean;
}

/** Read an Excel file and convert to PDF buffer */
export async function excelToPdf(
  filePath: string,
  options: ExcelToPdfOptions = {}
): Promise<Buffer> {
  const { paperSize = 'A4' } = options;

  logger.info({ filePath, paperSize }, 'Converting Excel to PDF');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const pageDims = getPaperSizeInPt(paperSize) || { width: 595.28, height: 841.89 }; // A4 fallback
  const content: unknown[] = [];

  workbook.eachSheet((worksheet, sheetIndex) => {
    if (sheetIndex > 1) {
      content.push({ text: '', pageBreak: 'before' });
    }

    // Add sheet name as title
    content.push({
      text: worksheet.name,
      fontSize: 14,
      bold: true,
      margin: [0, 0, 0, 8],
    });

    const tableBody: unknown[][] = [];
    const colWidths: number[] = [];

    // Calculate column widths
    const colCount = worksheet.columnCount;
    for (let c = 1; c <= colCount; c++) {
      const col = worksheet.getColumn(c);
      const w = col.width || 12;
      colWidths.push(w * 6); // rough character width -> pt
    }

    // Normalize column widths to fit page
    const availableWidth = pageDims.width - 80; // margins
    const totalColWidth = colWidths.reduce((s, w) => s + w, 0);
    const scale = totalColWidth > availableWidth ? availableWidth / totalColWidth : 1;
    const scaledWidths = colWidths.map((w) => w * scale);

    // Read rows
    worksheet.eachRow({ includeEmpty: false }, (row, _rowNumber) => {
      const cells: unknown[] = [];
      for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        const cellValue = cell.value;
        let text = '';

        if (cellValue === null || cellValue === undefined) {
          text = '';
        } else if (typeof cellValue === 'object' && 'result' in cellValue) {
          text = String((cellValue as { result: unknown }).result ?? '');
        } else if (typeof cellValue === 'object' && 'text' in cellValue) {
          text = String((cellValue as { text: string }).text);
        } else {
          text = String(cellValue);
        }

        const isBold = cell.font?.bold || false;
        const alignment = cell.alignment?.horizontal || 'left';

        cells.push({
          text,
          bold: isBold,
          alignment,
          fontSize: 9,
        });
      }
      tableBody.push(cells);
    });

    if (tableBody.length > 0) {
      content.push({
        table: {
          headerRows: 1,
          widths: scaledWidths.length > 0 ? scaledWidths : ['*'],
          body: tableBody,
        },
        layout: 'lightHorizontalLines',
      });
    }
  });

  const docDefinition = {
    pageSize: { width: pageDims.width, height: pageDims.height },
    pageMargins: [30, 30, 30, 30] as [number, number, number, number],
    defaultStyle: {
      font: fs.existsSync(path.join(config.fontDir, 'NotoSansTC-Regular.ttf'))
        ? 'NotoSansTC'
        : 'Roboto',
      fontSize: 10,
    },
    content,
  };

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const printer = createPrinter();
      const pdfDoc = printer.createPdfKitDocument(docDefinition as any);
      const chunks: Buffer[] = [];

      pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);
      pdfDoc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/** Read Excel file and return worksheet data (for preview/API) */
export async function readExcelData(filePath: string): Promise<{
  sheets: Array<{
    name: string;
    rows: string[][];
    colCount: number;
    rowCount: number;
  }>;
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets: Array<{
    name: string;
    rows: string[][];
    colCount: number;
    rowCount: number;
  }> = [];

  workbook.eachSheet((worksheet) => {
    const rows: string[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value;
        if (val === null || val === undefined) {
          cells.push('');
        } else if (typeof val === 'object' && 'result' in val) {
          cells.push(String((val as { result: unknown }).result ?? ''));
        } else {
          cells.push(String(val));
        }
      });
      rows.push(cells);
    });

    sheets.push({
      name: worksheet.name,
      rows,
      colCount: worksheet.columnCount,
      rowCount: worksheet.rowCount,
    });
  });

  return { sheets };
}
