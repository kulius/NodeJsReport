import { mmToPt } from './unit-converter';

export interface PaperDimensions {
  width: number;  // in PDF points
  height: number; // in PDF points
}

/** Convert mm paper size to PDF points for pdfmake */
export function paperSizeToPdfmake(widthMm: number, heightMm: number): PaperDimensions {
  return {
    width: mmToPt(widthMm),
    height: mmToPt(heightMm),
  };
}

/** Convert base64 PDF string to Buffer */
export function base64ToBuffer(base64: string): Buffer {
  const cleaned = base64.replace(/^data:application\/pdf;base64,/, '');
  return Buffer.from(cleaned, 'base64');
}

/** Convert Buffer to base64 string */
export function bufferToBase64(buffer: Buffer): string {
  return buffer.toString('base64');
}
