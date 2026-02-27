import { z } from 'zod';

export const generateRequestSchema = z.object({
  /** 報表類型（對應 report-formats 註冊 ID），預設 auto */
  reportType: z.string().default('auto'),
  /** 原始業務資料 */
  data: z.record(z.unknown()),
  /** 動作：print=直接列印, preview=預覽, download=下載 PDF */
  action: z.enum(['print', 'preview', 'download']).default('print'),
  /** 列印模式：pdf=PDF 列印（預設）, escp=ESC/P 直接列印, escp_debug=下載 .prn 檔 */
  mode: z.enum(['pdf', 'escp', 'escp_debug']).default('pdf'),
  /** 指定印表機（空=系統預設），限制字元防止命令注入 */
  printer: z.string()
    .max(256)
    .regex(/^[a-zA-Z0-9\s\-_./\\()]+$/, 'Printer name contains invalid characters')
    .optional(),
  /** 列印份數 */
  copies: z.number().int().min(1).max(100).default(1),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;
