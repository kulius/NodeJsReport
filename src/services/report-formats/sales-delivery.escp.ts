import type { EscpFormatFn } from './types';
import {
  buildEscpFromBitmapLines,
  buildLine,
  drawSeparator,
  padText,
  textWidth,
  type LineEntry,
} from '../escp.service';
import { FONT_SMALL } from '../bitmap-font.service';

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

/** 頁長：38 行 at 24/180" 行距 = 5.07" ≈ 130mm（中一刀） */
const PAGE_LINES = 38;

/**
 * 每頁固定行數（printer lines）：
 *   標題行（銷貨單）  = 1（一般字型，置中）
 *   company name line = 1
 *   address line      = 1
 *   telFax line       = 1（始終輸出，確保行數固定）
 *   drawSeparator     = 1
 *   客戶資訊 5 行      = 5
 *   表頭分隔+欄名+分隔 = 3
 *   Header 合計       = 13
 *
 *   表格底部分隔線    = 1
 *   合計行            = 1
 *   底部分隔線        = 1
 *   簽名行            = 1
 *   Footer 合計       = 4
 *
 *   可用明細行 = PAGE_LINES(38) - HEADER_LINES(13) - FOOTER_LINES(4) = 21
 */
const HEADER_LINES = 13;
const FOOTER_LINES = 4;
const MAX_DETAIL_LINES = PAGE_LINES - HEADER_LINES - FOOTER_LINES; // 21

/** 9 欄欄寬（半形字元數）— v0.3.9 調整有效日期欄寬 */
const COL = {
  englishName: 21,   // -1 for expiryDate space
  productName: 19,   // -1 for expiryDate space
  qty: 5,
  unit: 3,
  spec: 8,
  unitPrice: 8,
  amount: 9,
  lotNumber: 7,
  expiryDate: 10,    // +2 → fits full YYYY-MM-DD
} as const;
// Data: 21+19+5+3+8+8+9+7+10 = 90
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

/** 空白明細行（用於填充頁面） */
const EMPTY_ROW_TEXT = tableRow(
  Object.values(COL).map(w => ({ text: '', width: w }))
);

/**
 * Build LineEntry[] for sales delivery (shared by print + preview)
 *
 * 分頁邏輯：每頁固定 PAGE_LINES(38) 行：
 *   HEADER_LINES(13) + MAX_DETAIL_LINES(24) + FOOTER_LINES(4) = 41
 * 超過 MAX_DETAIL_LINES 的 items 自動分到下一頁。
 * 合計資訊只在最後一頁顯示，其他頁 footer 以空白行維持固定高度。
 */
export function salesDeliveryEscpLines(rawData: Record<string, unknown>): LineEntry[] {
  const data = rawData as unknown as SalesDeliveryData;
  const company = data.company ?? {};
  const customer = data.customer ?? {};
  const docInfo = data.docInfo ?? {};
  const items = data.items ?? [];
  const totals = data.totals ?? {};

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

  // ── Step 1: 預計算每個 item 的明細行 ──
  interface ItemRows {
    readonly rows: LineEntry[];
  }
  const allItemRows: ItemRows[] = items.map(item => {
    const engLines = wrapText(item.englishName ?? '', COL.englishName);
    const nameLines = wrapText(item.productName ?? '', COL.productName);
    const rowHeight = Math.max(engLines.length, nameLines.length);
    const rows: LineEntry[] = [];
    for (let r = 0; r < rowHeight; r++) {
      const isFirstLine = r === 0;
      rows.push(small(tableRow([
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
    }
    return { rows };
  });

  // ── Step 2: 分頁 ──
  interface PageData {
    readonly itemRows: ItemRows[];
    readonly isLastPage: boolean;
  }
  const pages: PageData[] = [];
  let currentPageItems: ItemRows[] = [];
  let currentLineCount = 0;

  for (const itemRow of allItemRows) {
    const rowLen = itemRow.rows.length;
    if (currentLineCount + rowLen > MAX_DETAIL_LINES && currentPageItems.length > 0) {
      pages.push({ itemRows: [...currentPageItems], isLastPage: false });
      currentPageItems = [];
      currentLineCount = 0;
    }
    currentPageItems.push(itemRow);
    currentLineCount += rowLen;
  }
  // 最後一頁（含空單）
  pages.push({ itemRows: currentPageItems, isLastPage: true });

  const totalPages = pages.length;

  // ── Step 3: 組合每頁輸出 ──
  const allLines: LineEntry[] = [];

  // 版面常數
  const lbl = 10;
  const halfW = Math.floor(LINE_WIDTH / 2);
  const v1 = halfW - lbl;
  const v2 = LINE_WIDTH - halfW - lbl;

  const companyName = company.name ?? '';
  const addressText = company.address ?? '';
  const companyCode = company.code ?? customer.companyCode ?? '';
  const telFax = [
    company.tel ? `TEL:${company.tel}` : '',
    company.fax ? `FAX:${company.fax}` : '',
  ].filter(Boolean).join('  ');

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

  const notesText = data.notes ?? '';
  const sigBlock = '製表    覆核    客戶簽收';
  const sigW = textWidth(sigBlock);
  const sigLine = buildLine([
    { text: notesText ? `備註:${notesText}` : '', width: LINE_WIDTH - sigW },
    { text: sigBlock, width: sigW, align: 'right' },
  ]);

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    const pageNum = pageIdx + 1;
    const pageInfo = `${pageNum}/${totalPages}`;

    // ── Header (13 printer lines) ──

    // Line 1: 銷貨單 置中 + 頁碼右側（一般字型）
    const title = '銷貨單';
    const titleW = textWidth(title);
    const titleLeftPad = Math.floor((LINE_WIDTH - titleW) / 2);
    allLines.push(buildLine([
      { text: '', width: titleLeftPad, align: 'left' },
      { text: title, width: titleW, align: 'left' },
      { text: pageInfo, width: LINE_WIDTH - titleLeftPad - titleW, align: 'right' },
    ]));

    // Line 2: 公司名稱
    allLines.push(companyName || '');

    // Line 3: 地址 + 公司編碼
    const rightPart = companyCode ? `公司編碼:${companyCode}` : '';
    const rightPartW = textWidth(rightPart);
    allLines.push(buildLine([
      { text: addressText, width: LINE_WIDTH - rightPartW, align: 'left' },
      { text: rightPart, width: rightPartW, align: 'right' },
    ]));

    // Line 3: TEL + FAX（固定輸出，確保行數不因 telFax 有無而變動）
    allLines.push(telFax || '');

    // Line 4: 分隔線
    allLines.push(drawSeparator(LINE_WIDTH, SEP_H));

    // Lines 5-9: 客戶資訊 5 行
    allLines.push(buildLine([
      { text: '統一編號:', width: lbl },
      { text: customer.taxId ?? '', width: v1 },
      { text: '電話號碼:', width: lbl },
      { text: customer.phone ?? '', width: v2 },
    ]));

    allLines.push(buildLine([
      { text: '公司名稱:', width: lbl },
      { text: customer.companyName ?? '', width: v1 },
      { text: '收款方式:', width: lbl },
      { text: customer.paymentMethod ?? '', width: v2 },
    ]));

    allLines.push(buildLine([
      { text: '裝貨地址:', width: lbl },
      { text: customer.invoiceAddress ?? '', width: v1 },
      { text: '單據日期:', width: lbl },
      { text: docInfo.date ?? '', width: v2 },
    ]));

    allLines.push(buildLine([
      { text: '送貨地址:', width: lbl },
      { text: customer.shippingAddress ?? '', width: v1 },
      { text: '單據號碼:', width: lbl },
      { text: docInfo.docNumber ?? '', width: v2 },
    ]));

    allLines.push(buildLine([
      { text: '', width: halfW },
      { text: '發票號碼:', width: lbl },
      { text: docInfo.invoiceNumber ?? '', width: v2 },
    ]));

    // Lines 10-12: 表頭
    allLines.push(small(tableSeparator()));
    allLines.push(small(tableRow(colDefs)));
    allLines.push(small(tableSeparator()));

    // ── Detail rows (up to MAX_DETAIL_LINES printer lines) ──
    let detailLineCount = 0;
    for (const itemRow of page.itemRows) {
      for (const row of itemRow.rows) {
        allLines.push(row);
        detailLineCount++;
      }
    }

    // 填充空行到 MAX_DETAIL_LINES
    for (let i = detailLineCount; i < MAX_DETAIL_LINES; i++) {
      allLines.push(small(EMPTY_ROW_TEXT));
    }

    // ── Footer (4 printer lines) ──

    // Line 1: 表格底部分隔線
    allLines.push(small(tableSeparator()));

    if (page.isLastPage) {
      // Line 2: 合計行
      allLines.push(totalLine);
      // Line 3: 分隔線
      allLines.push(drawSeparator(LINE_WIDTH, SEP_H));
      // Line 4: 簽名行
      allLines.push(sigLine);
    } else {
      // 非最後頁：以空白行維持固定高度，並標示「續下頁」
      const continueText = '（續下頁）';
      const continueW = textWidth(continueText);
      allLines.push(buildLine([
        { text: '', width: LINE_WIDTH - continueW },
        { text: continueText, width: continueW, align: 'right' },
      ]));
      allLines.push(drawSeparator(LINE_WIDTH, SEP_H));
      allLines.push(buildLine([
        { text: '', width: LINE_WIDTH - sigW },
        { text: sigBlock, width: sigW, align: 'right' },
      ]));
    }
  }

  return allLines;
}

export const salesDeliveryEscp: EscpFormatFn = (rawData) => {
  const lines = salesDeliveryEscpLines(rawData);
  return buildEscpFromBitmapLines({
    lines,
    formFeed: true,
    pageLines: PAGE_LINES,
  });
};
