import type { EscpFormatFn } from './types';
import {
  buildEscpFromBitmapLines,
  buildLine,
  drawSeparator,
  padText,
  textWidth,
  type LineEntry,
} from '../escp.service';
import { FONT_LARGE, FONT_SMALL } from '../bitmap-font.service';

/**
 * 銷貨單 ESC/P 版面 — 中一刀 241mm × 140mm（對齊 Photo 2）
 *
 * 紙張方向：寬 241mm (~9.5") × 高 140mm (~5.5")
 * 行寬：118 半形字元 (1416 dots = 7.87")，在 8" 可列印區內
 * 行密度：1/8" 行距 (24/180) → 44 行/頁
 * 頁長：44 行 (ESC C 44)
 *
 * 列印模式：24-pin bitmap 圖形模式 (ESC * 33)。
 * 所有文字（ASCII + CJK）都用 opentype.js 渲染成 bitmap，
 * 透過 ESC * 圖形指令送出，不依賴印表機的中文韌體。
 */

interface Company {
  readonly name?: string;
  readonly address?: string;
  readonly tel?: string;
  readonly fax?: string;
  readonly code?: string;
}

interface Customer {
  readonly companyName?: string;
  readonly taxId?: string;
  readonly invoiceAddress?: string;
  readonly shippingAddress?: string;
  readonly companyCode?: string;
  readonly phone?: string;
  readonly paymentMethod?: string;
}

interface DocInfo {
  readonly date?: string;
  readonly docNumber?: string;
  readonly invoiceNumber?: string;
}

interface LineItem {
  readonly englishName?: string;
  readonly productName?: string;
  readonly qty?: number;
  readonly unit?: string;
  readonly specification?: string;
  readonly unitPrice?: number;
  readonly amount?: number;
  readonly lotNumber?: string;
  readonly expiryDate?: string;
}

interface Totals {
  readonly subtotal?: number;
  readonly overpayment?: number;
  readonly discount?: number;
  readonly totalDue?: number;
}

interface SalesDeliveryData {
  readonly company?: Company;
  readonly customer?: Customer;
  readonly docInfo?: DocInfo;
  readonly items?: readonly LineItem[];
  readonly totals?: Totals;
  readonly notes?: string;
  readonly pageNumber?: number;
  readonly totalPages?: number;
}

// ── 版面常數 ──

/** 總行寬 118 半形字元 → 118 × 12px = 1416 dots = 7.87"（241mm 紙張 8" 可列印區內） */
const LINE_WIDTH = 118;

/** 頁長：44 行 at 1/8" 行距 = 5.5" = 140mm */
const PAGE_LINES = 44;

/** 9 欄欄寬（半形字元數）— v0.3.8 加寬名稱欄、壓縮其他欄 */
const COL = {
  englishName: 22,   // was 18 (+4), e.g. "CALCIUM CARBONATE TABLET"
  productName: 20,   // was 16 (+4), e.g. "碳酸鈣嚼錠" (10 CJK)
  qty: 5,            // same
  unit: 3,           // was 4 (-1)
  spec: 8,           // was 10 (-2)
  unitPrice: 8,      // was 9 (-1)
  amount: 9,         // was 10 (-1)
  lotNumber: 7,      // was 8 (-1)
  expiryDate: 8,     // was 10 (-2)
} as const;
// Data: 22+20+5+3+8+8+9+7+8 = 90
// Borders: 10 pipes + 9×2 padding = 28
// Grand total: 90 + 28 = 118 ✓

/** 分隔符字元 */
const SEP_H = '-';
const SEP_V = '|';
const SEP_CROSS = '+';

function fmt(val: number | undefined): string {
  if (val === undefined || val === null) return '';
  return val.toLocaleString('zh-TW');
}

/**
 * 將長文字拆成多行，每行不超過 maxWidth 半形字元。
 * 尊重 CJK 字寬（每字佔 2 半形）。
 */
function wrapText(text: string, maxWidth: number): readonly string[] {
  if (!text || textWidth(text) <= maxWidth) return [text || ''];
  const lines: string[] = [];
  let remaining = text;
  while (textWidth(remaining) > maxWidth) {
    let breakAt = 0;
    let width = 0;
    for (const char of remaining) {
      const cw = textWidth(char);
      if (width + cw > maxWidth) break;
      width += cw;
      breakAt++;
    }
    lines.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt);
  }
  if (remaining) lines.push(remaining);
  return lines;
}

/** 畫表格水平分隔線（9 欄） */
function tableSeparator(): string {
  const widths = Object.values(COL);
  const segments = widths.map(w => SEP_H.repeat(w + 2)); // +2 for padding
  return SEP_CROSS + segments.join(SEP_CROSS) + SEP_CROSS;
}

/** 畫表格資料行（9 欄） */
function tableRow(cells: ReadonlyArray<{ readonly text: string; readonly width: number; readonly align?: 'left' | 'right' | 'center' }>): string {
  const formatted = cells.map(c => ' ' + padText(c.text, c.width, c.align ?? 'left') + ' ');
  return SEP_V + formatted.join(SEP_V) + SEP_V;
}

/**
 * 銷貨單 ESC/P 格式（對齊 Photo 2 — 9 欄版面）
 *
 * 回傳 ESC/P command buffer，直接送到點陣印表機。
 * 不經過 pdfmake / SumatraPDF。
 */
export const salesDeliveryEscp: EscpFormatFn = (rawData) => {
  const data = rawData as unknown as SalesDeliveryData;
  const company = data.company ?? {};
  const customer = data.customer ?? {};
  const docInfo = data.docInfo ?? {};
  const items = data.items ?? [];
  const totals = data.totals ?? {};
  const pageNum = data.pageNumber ?? 1;
  const totalPages = data.totalPages ?? 1;

  const lines: LineEntry[] = [];

  // ── 標題「銷貨單」— 大字型（2 行高） ──
  const companyName = company.name ?? '';
  const title = '銷貨單';
  // 大字型標題：公司名稱在左 + 銷貨單在右，使用 FONT_LARGE
  const titleWidth = textWidth(title);
  lines.push({
    text: buildLine([
      { text: companyName, width: LINE_WIDTH - titleWidth, align: 'left' },
      { text: title, width: titleWidth, align: 'right' },
    ]),
    fontSize: FONT_LARGE,
  });

  // ── 表頭 Line 2: 地址（左）+ 公司編碼 + 頁碼（右） ──
  const addressText = company.address ?? '';
  const companyCode = company.code ?? customer.companyCode ?? '';
  const pageInfo = `${pageNum}/${totalPages}`;
  const rightPart = [
    companyCode ? `公司編碼:${companyCode}` : '',
    pageInfo,
  ].filter(Boolean).join('    ');
  const rightPartW = textWidth(rightPart);
  lines.push(buildLine([
    { text: addressText, width: LINE_WIDTH - rightPartW, align: 'left' },
    { text: rightPart, width: rightPartW, align: 'right' },
  ]));

  // ── 表頭 Line 3: TEL + FAX ──
  const telFax = [
    company.tel ? `TEL:${company.tel}` : '',
    company.fax ? `FAX:${company.fax}` : '',
  ].filter(Boolean).join('  ');
  if (telFax) {
    lines.push(telFax);
  }

  // ── 分隔線 ──
  lines.push(drawSeparator(LINE_WIDTH, SEP_H));

  // ── 客戶資訊區（5 行，2 欄配置，對齊 Photo 2） ──
  const lbl = 10;  // 中文標籤寬度（含冒號）
  const halfW = Math.floor(LINE_WIDTH / 2);
  const v1 = halfW - lbl;    // 第一欄值寬度
  const v2 = LINE_WIDTH - halfW - lbl;  // 第二欄值寬度

  lines.push(buildLine([
    { text: '統一編號:', width: lbl },
    { text: customer.taxId ?? '', width: v1 },
    { text: '電話號碼:', width: lbl },
    { text: customer.phone ?? '', width: v2 },
  ]));

  lines.push(buildLine([
    { text: '公司名稱:', width: lbl },
    { text: customer.companyName ?? '', width: v1 },
    { text: '收款方式:', width: lbl },
    { text: customer.paymentMethod ?? '', width: v2 },
  ]));

  lines.push(buildLine([
    { text: '裝貨地址:', width: lbl },
    { text: customer.invoiceAddress ?? '', width: v1 },
    { text: '單據日期:', width: lbl },
    { text: docInfo.date ?? '', width: v2 },
  ]));

  lines.push(buildLine([
    { text: '送貨地址:', width: lbl },
    { text: customer.shippingAddress ?? '', width: v1 },
    { text: '單據號碼:', width: lbl },
    { text: docInfo.docNumber ?? '', width: v2 },
  ]));

  lines.push(buildLine([
    { text: '', width: halfW },
    { text: '發票號碼:', width: lbl },
    { text: docInfo.invoiceNumber ?? '', width: v2 },
  ]));

  // ── 明細表格（9 欄）— 使用 FONT_SMALL 渲染 ──
  const small = (text: string): LineEntry => ({ text, fontSize: FONT_SMALL });

  const colDefs = [
    { text: '英文品名', width: COL.englishName, align: 'center' as const },
    { text: '貨品名稱', width: COL.productName, align: 'center' as const },
    { text: '數量', width: COL.qty, align: 'center' as const },
    { text: '單位', width: COL.unit, align: 'center' as const },
    { text: '規格', width: COL.spec, align: 'center' as const },
    { text: '單價', width: COL.unitPrice, align: 'center' as const },
    { text: '金額', width: COL.amount, align: 'center' as const },
    { text: '批號', width: COL.lotNumber, align: 'center' as const },
    { text: '有效日期', width: COL.expiryDate, align: 'center' as const },
  ];

  lines.push(small(tableSeparator()));
  lines.push(small(tableRow(colDefs)));
  lines.push(small(tableSeparator()));

  // 明細行 — 支援 multi-line（英文品名/貨品名稱自動換行）
  let dataRowCount = 0;
  for (const item of items) {
    const engLines = wrapText(item.englishName ?? '', COL.englishName);
    const nameLines = wrapText(item.productName ?? '', COL.productName);
    const rowHeight = Math.max(engLines.length, nameLines.length);

    for (let r = 0; r < rowHeight; r++) {
      const isFirstLine = r === 0;
      lines.push(small(tableRow([
        { text: engLines[r] ?? '', width: COL.englishName },
        { text: nameLines[r] ?? '', width: COL.productName },
        { text: isFirstLine ? fmt(item.qty) : '', width: COL.qty, align: 'right' },
        { text: isFirstLine ? (item.unit ?? '') : '', width: COL.unit, align: 'center' },
        { text: isFirstLine ? (item.specification ?? '') : '', width: COL.spec, align: 'center' },
        { text: isFirstLine ? fmt(item.unitPrice) : '', width: COL.unitPrice, align: 'right' },
        { text: isFirstLine ? fmt(item.amount) : '', width: COL.amount, align: 'right' },
        { text: isFirstLine ? (item.lotNumber ?? '') : '', width: COL.lotNumber, align: 'center' },
        { text: isFirstLine ? (item.expiryDate ?? '') : '', width: COL.expiryDate, align: 'center' },
      ])));
      dataRowCount++;
    }
  }

  // 填充空行到最少 8 行
  const minRows = 8;
  const emptyRow = tableRow(
    Object.values(COL).map(w => ({ text: '', width: w }))
  );
  for (let i = dataRowCount; i < minRows; i++) {
    lines.push(small(emptyRow));
  }

  lines.push(small(tableSeparator()));

  // ── 合計區（對齊 Photo 2：總計 / 折讓 / 收） ──
  const totalLine = buildLine([
    { text: '總  計', width: 8, align: 'right' },
    { text: fmt(totals.subtotal), width: 16, align: 'right' },
    { text: '', width: 20 },
    { text: '折讓', width: 6, align: 'right' },
    { text: fmt(totals.discount), width: 16, align: 'right' },
    { text: '', width: 14 },
    { text: '收', width: 4, align: 'right' },
    { text: fmt(totals.totalDue), width: LINE_WIDTH - 8 - 16 - 20 - 6 - 16 - 14 - 4, align: 'right' },
  ]);
  lines.push(totalLine);

  lines.push(drawSeparator(LINE_WIDTH, SEP_H));

  // ── 附註 + 簽名欄 ──
  const notesText = data.notes ?? '';
  const sigBlock = '製表    覆核    客戶簽收';
  const sigW = textWidth(sigBlock);
  const sigLine = buildLine([
    { text: notesText ? `備註:${notesText}` : '', width: LINE_WIDTH - sigW },
    { text: sigBlock, width: sigW, align: 'right' },
  ]);
  lines.push(sigLine);

  // ── 組合成 ESC/P buffer（bitmap 圖形模式） ──
  return buildEscpFromBitmapLines({
    lines,
    formFeed: true,
    pageLines: PAGE_LINES, // 44 lines = 5.5" = 140mm 中一刀
  });
};
