import type { ReportDefinition } from '../../models/report-definition.model';

/** 報表格式函式：接收原始資料，回傳 pdfmake definition */
export type ReportFormatFn = (data: Record<string, unknown>) => ReportDefinition;

/** ESC/P 格式函式：接收原始資料，回傳 ESC/P command buffer */
export type EscpFormatFn = (data: Record<string, unknown>) => Buffer;

/** 報表格式註冊資訊 */
export interface ReportFormatInfo {
  readonly name: string;
  readonly description: string;
  readonly format: ReportFormatFn;
  /** ESC/P 直接列印格式（點陣印表機用） */
  readonly escpFormat?: EscpFormatFn;
  /** JSON Schema（含 examples），內嵌後不依賴外部檔案 */
  readonly schema?: Record<string, unknown>;
}
