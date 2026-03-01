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
 * 估價單 ESC/P 版面 — 中一刀 241mm × 140mm
 *
 * 與銷貨單類似但：無公司表頭、標題為「估價單」、無簽名欄
 */

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
  readonly spec?: string;
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

interface QuotationData {
  readonly customer?: Customer;
  readonly docInfo?: DocInfo;
  readonly items?: readonly LineItem[];
  readonly totals?: Totals;
  readonly pageNumber?: number;
  readonly totalPages?: number;
}

// ── 版面常數（與銷貨單相同） ──

const LINE_WIDTH = 118;
const PAGE_LINES = 44;

const COL = {
  englishName: 22,
  productName: 20,
  qty: 5,
  unit: 3,
  spec: 8,
  unitPrice: 8,
  amount: 9,
  lotNumber: 7,
  expiryDate: 8,
} as const;

const SEP_H = '-';
const SEP_V = '|';
const SEP_CROSS = '+';

function fmt(val: number | undefined): string {
  if (val === undefined || val === null) return '';
  return val.toLocaleString('zh-TW');
}

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

function tableSeparator(): string {
  const widths = Object.values(COL);
  const segments = widths.map(w => SEP_H.repeat(w + 2));
  return SEP_CROSS + segments.join(SEP_CROSS) + SEP_CROSS;
}

function tableRow(cells: ReadonlyArray<{ readonly text: string; readonly width: number; readonly align?: 'left' | 'right' | 'center' }>): string {
  const formatted = cells.map(c => ' ' + padText(c.text, c.width, c.align ?? 'left') + ' ');
  return SEP_V + formatted.join(SEP_V) + SEP_V;
}

export const quotationEscp: EscpFormatFn = (rawData) => {
  const data = rawData as unknown as QuotationData;
  const customer = data.customer ?? {};
  const docInfo = data.docInfo ?? {};
  const items = data.items ?? [];
  const totals = data.totals ?? {};
  const pageNum = data.pageNumber ?? 1;
  const totalPages = data.totalPages ?? 1;

  const lines: LineEntry[] = [];

  // ── 標題「估價單」— 大字型 ──
  const title = '估  價  單';
  const pageInfo = `${pageNum}/${totalPages}`;
  const pageInfoW = textWidth(pageInfo);
  lines.push({
    text: buildLine([
      { text: '', width: LINE_WIDTH - textWidth(title) - pageInfoW, align: 'left' },
      { text: title, width: textWidth(title), align: 'center' },
      { text: pageInfo, width: pageInfoW, align: 'right' },
    ]),
    fontSize: FONT_LARGE,
  });

  // ── 分隔線 ──
  lines.push(drawSeparator(LINE_WIDTH, SEP_H));

  // ── 客戶資訊區（4 行，2 欄配置） ──
  const lbl = 10;
  const halfW = Math.floor(LINE_WIDTH / 2);
  const v1 = halfW - lbl;
  const v2 = LINE_WIDTH - halfW - lbl;

  lines.push(buildLine([
    { text: '公司名稱:', width: lbl },
    { text: customer.companyName ?? '', width: v1 },
    { text: '日　　期:', width: lbl },
    { text: docInfo.date ?? '', width: v2 },
  ]));

  lines.push(buildLine([
    { text: '統一編號:', width: lbl },
    { text: customer.taxId ?? '', width: v1 },
    { text: '電話號碼:', width: lbl },
    { text: customer.phone ?? '', width: v2 },
  ]));

  lines.push(buildLine([
    { text: '發票地址:', width: lbl },
    { text: customer.invoiceAddress ?? '', width: v1 },
    { text: '單據號碼:', width: lbl },
    { text: docInfo.docNumber ?? '', width: v2 },
  ]));

  lines.push(buildLine([
    { text: '送貨地址:', width: lbl },
    { text: customer.shippingAddress ?? '', width: v1 },
    { text: '發票號碼:', width: lbl },
    { text: docInfo.invoiceNumber ?? '', width: v2 },
  ]));

  // ── 明細表格（9 欄）— FONT_SMALL ──
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

  // 明細行
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
        { text: isFirstLine ? (item.spec ?? '') : '', width: COL.spec, align: 'center' },
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

  // ── 合計區 ──
  const totalLine = buildLine([
    { text: '總  計', width: 8, align: 'right' },
    { text: fmt(totals.subtotal), width: 16, align: 'right' },
    { text: '', width: 10 },
    { text: '溢收', width: 6, align: 'right' },
    { text: fmt(totals.overpayment), width: 12, align: 'right' },
    { text: '', width: 10 },
    { text: '折讓', width: 6, align: 'right' },
    { text: fmt(totals.discount), width: 12, align: 'right' },
    { text: '', width: 10 },
    { text: '應收', width: 6, align: 'right' },
    { text: fmt(totals.totalDue), width: LINE_WIDTH - 8 - 16 - 10 - 6 - 12 - 10 - 6 - 12 - 10 - 6, align: 'right' },
  ]);
  lines.push(totalLine);

  // ── 組合成 ESC/P buffer ──
  return buildEscpFromBitmapLines({
    lines,
    formFeed: true,
    pageLines: PAGE_LINES,
  });
};
