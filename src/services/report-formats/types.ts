import type { ReportDefinition } from '../../models/report-definition.model';

/** 報表格式函式：接收原始資料，回傳 pdfmake definition */
export type ReportFormatFn = (data: Record<string, unknown>) => ReportDefinition;

/** 報表格式註冊資訊 */
export interface ReportFormatInfo {
  readonly name: string;
  readonly description: string;
  readonly format: ReportFormatFn;
  /** JSON Schema（含 examples），內嵌後不依賴外部檔案 */
  readonly schema?: Record<string, unknown>;
}
