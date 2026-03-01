import type { EscpFormatFn } from './types';
import {
  buildEscpFromBitmapLines,
  buildLine,
  padText,
  textWidth,
  type LineEntry,
} from '../escp.service';
import { FONT_LARGE, FONT_SMALL } from '../bitmap-font.service';

/**
 * 估價單 ESC/P 版面 — 中一刀 241mm × 140mm
 *
 * 與銷貨單版面不同：
 * - 大標題「估價單」置中 + 頁碼右側
 * - 客戶資訊：3 欄框線表格（label:value × 3）
 * - 明細：9 欄（與銷貨單相同）
 * - 合計：左側垂直排列（貨單總計/溢收金額/折讓）+ 右側「應收」
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

// ── 版面常數 ──

const LINE_WIDTH = 118;
const PAGE_LINES = 44;

/** 明細 9 欄欄寬 */
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

/**
 * 客戶資訊 3 欄表格寬度
 * 4 pipes + 6 padding = 10, content = 108
 * Col1: 46 (label 10 + value 36) — 公司名稱/統一編號/發票地址/送貨地址
 * Col2: 31 (label 10 + value 21) — 公司編碼/電話號碼/收款方式
 * Col3: 31 (label 10 + value 21) — 單據日期/單據號碼/發票號碼
 */
const INFO_COL1 = 46;
const INFO_COL2 = 31;
const INFO_COL3 = 31;
const INFO_LBL = 10; // 中文標籤寬度（5 CJK = 10 半形）

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

/** 明細表格水平分隔線（9 欄） */
function detailSeparator(): string {
  const widths = Object.values(COL);
  const segments = widths.map(w => SEP_H.repeat(w + 2));
  return SEP_CROSS + segments.join(SEP_CROSS) + SEP_CROSS;
}

/** 明細表格資料行（9 欄） */
function detailRow(cells: ReadonlyArray<{ readonly text: string; readonly width: number; readonly align?: 'left' | 'right' | 'center' }>): string {
  const formatted = cells.map(c => ' ' + padText(c.text, c.width, c.align ?? 'left') + ' ');
  return SEP_V + formatted.join(SEP_V) + SEP_V;
}

/** 客戶資訊表格水平分隔線（3 欄） */
function infoSeparator(): string {
  return SEP_CROSS
    + SEP_H.repeat(INFO_COL1 + 2) + SEP_CROSS
    + SEP_H.repeat(INFO_COL2 + 2) + SEP_CROSS
    + SEP_H.repeat(INFO_COL3 + 2) + SEP_CROSS;
}

/** 客戶資訊表格資料行（3 欄，每欄 = label + value） */
function infoRow(
  label1: string, value1: string,
  label2: string, value2: string,
  label3: string, value3: string,
): string {
  const v1w = INFO_COL1 - INFO_LBL;
  const v2w = INFO_COL2 - INFO_LBL;
  const v3w = INFO_COL3 - INFO_LBL;

  const c1 = padText(label1, INFO_LBL) + padText(value1, v1w);
  const c2 = padText(label2, INFO_LBL) + padText(value2, v2w);
  const c3 = padText(label3, INFO_LBL) + padText(value3, v3w);

  return SEP_V + ' ' + c1 + ' '
    + SEP_V + ' ' + c2 + ' '
    + SEP_V + ' ' + c3 + ' '
    + SEP_V;
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

  // ── 空行 + 標題「估價單」置中（大字型） ──
  lines.push('');

  const title = '估  價  單';
  const titleW = textWidth(title);
  const pageInfo = `${pageNum}/${totalPages}`;
  const pageInfoW = textWidth(pageInfo);
  const leftPad = Math.floor((LINE_WIDTH - titleW) / 2);
  lines.push({
    text: buildLine([
      { text: '', width: leftPad, align: 'left' },
      { text: title, width: titleW, align: 'left' },
      { text: pageInfo, width: LINE_WIDTH - leftPad - titleW, align: 'right' },
    ]),
    fontSize: FONT_LARGE,
  });

  lines.push('');

  // ── 客戶資訊區（3 欄框線表格，4 行） ──
  lines.push(infoSeparator());

  // Row 1: 公司名稱 | 公司編碼 | 單據日期
  lines.push(infoRow(
    '公司名稱：', customer.companyName ?? '',
    '公司編碼：', customer.companyCode ?? '',
    '單據日期：', docInfo.date ?? '',
  ));
  lines.push(infoSeparator());

  // Row 2: 統一編號 | 電話號碼 | (空)
  lines.push(infoRow(
    '統一編號：', customer.taxId ?? '',
    '電話號碼：', customer.phone ?? '',
    '', '',
  ));
  lines.push(infoSeparator());

  // Row 3: 發票地址 | 收款方式 | 單據號碼
  lines.push(infoRow(
    '發票地址：', customer.invoiceAddress ?? '',
    '收款方式：', customer.paymentMethod ?? '',
    '單據號碼：', docInfo.docNumber ?? '',
  ));
  lines.push(infoSeparator());

  // Row 4: 送貨地址 | (空) | 發票號碼
  lines.push(infoRow(
    '送貨地址：', customer.shippingAddress ?? '',
    '', '',
    '發票號碼：', docInfo.invoiceNumber ?? '',
  ));
  lines.push(infoSeparator());

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

  lines.push(small(detailSeparator()));
  lines.push(small(detailRow(colDefs)));
  lines.push(small(detailSeparator()));

  // 明細行
  let dataRowCount = 0;
  for (const item of items) {
    const engLines = wrapText(item.englishName ?? '', COL.englishName);
    const nameLines = wrapText(item.productName ?? '', COL.productName);
    const rowHeight = Math.max(engLines.length, nameLines.length);

    for (let r = 0; r < rowHeight; r++) {
      const isFirstLine = r === 0;
      lines.push(small(detailRow([
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
  const emptyRow = detailRow(
    Object.values(COL).map(w => ({ text: '', width: w }))
  );
  for (let i = dataRowCount; i < minRows; i++) {
    lines.push(small(emptyRow));
  }

  lines.push(small(detailSeparator()));

  // ── 合計區（左側垂直：貨單總計/溢收金額/折讓，右側：應收） ──
  // Line 1: 貨單總計  xxx
  lines.push(buildLine([
    { text: '貨單總計', width: 10, align: 'right' },
    { text: fmt(totals.subtotal), width: 16, align: 'right' },
    { text: '', width: LINE_WIDTH - 10 - 16 },
  ]));

  // Line 2: 溢收金額  xxx
  lines.push(buildLine([
    { text: '溢收金額', width: 10, align: 'right' },
    { text: fmt(totals.overpayment), width: 16, align: 'right' },
    { text: '', width: LINE_WIDTH - 10 - 16 },
  ]));

  // Line 3: 折讓  xxx                          應  收：  xxx
  const totalDueStr = fmt(totals.totalDue);
  const totalDueLabel = '應  收：';
  const totalDueLabelW = textWidth(totalDueLabel);
  const totalDueValW = 16;
  const leftPartW = 10 + 16; // 折讓 label + value
  const rightPartW = totalDueLabelW + totalDueValW;
  lines.push(buildLine([
    { text: '折　　讓', width: 10, align: 'right' },
    { text: fmt(totals.discount), width: 16, align: 'right' },
    { text: '', width: LINE_WIDTH - leftPartW - rightPartW },
    { text: totalDueLabel, width: totalDueLabelW, align: 'right' },
    { text: totalDueStr, width: totalDueValW, align: 'right' },
  ]));

  // ── 組合成 ESC/P buffer ──
  return buildEscpFromBitmapLines({
    lines,
    formFeed: true,
    pageLines: PAGE_LINES,
  });
};
