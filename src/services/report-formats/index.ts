import type { ReportFormatFn, ReportFormatInfo } from './types';
import { autoFormat } from './auto.format';
import { salesDeliveryFormat } from './sales-delivery.format';
import { salesDeliverySchema } from './sales-delivery.schema';

/** 報表格式註冊表 — AI 產生的格式都在這裡註冊 */
const registry = new Map<string, ReportFormatInfo>();

function register(id: string, info: ReportFormatInfo): void {
  registry.set(id, info);
}

// --- 內建格式 ---
register('auto', {
  name: '自動排版',
  description: '智能偵測 JSON 結構，自動產生報表',
  format: autoFormat,
});

// --- AI 產生的格式在這裡新增 ---
register('sales_delivery', {
  name: '銷貨單',
  description: '銷貨單（中一刀 241×140mm），含表頭、客戶資訊、明細、合計、簽名欄',
  format: salesDeliveryFormat,
  schema: salesDeliverySchema,
});

/** 取得格式函式 */
export function getFormat(reportType: string): ReportFormatFn | undefined {
  return registry.get(reportType)?.format;
}

/** 用 schemaId 查找內嵌 schema（schemaId 可用連字號或底線） */
export function getSchema(schemaId: string): Record<string, unknown> | undefined {
  // 嘗試原始 ID，再嘗試連字號↔底線互轉
  const candidates = [schemaId, schemaId.replace(/-/g, '_'), schemaId.replace(/_/g, '-')];
  for (const id of candidates) {
    const info = registry.get(id);
    if (info?.schema) return info.schema;
  }
  return undefined;
}

/** 列出所有已註冊的格式 */
export function listFormats(): Array<{ id: string; name: string; description: string }> {
  return Array.from(registry.entries()).map(([id, info]) => ({
    id,
    name: info.name,
    description: info.description,
  }));
}
