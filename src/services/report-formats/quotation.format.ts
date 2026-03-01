import type { ReportFormatFn } from './types';

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
}

const BORDER_COLOR = '#000000';
const HEADER_BG = '#E8E8E8';

function fmt(val: number | undefined): string {
  if (val === undefined || val === null) return '';
  return val.toLocaleString('zh-TW');
}

function cell(text: string, opts: Record<string, unknown> = {}): Record<string, unknown> {
  return { text, fontSize: 6.5, margin: [2, 1, 2, 1], ...opts };
}

function headerCell(text: string, opts: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    text,
    fontSize: 6.5,
    bold: true,
    alignment: 'center' as const,
    fillColor: HEADER_BG,
    margin: [2, 2, 2, 2],
    ...opts,
  };
}

function labelCell(text: string): Record<string, unknown> {
  return { text, fontSize: 6, bold: true, margin: [2, 1, 2, 1] };
}

function valueCell(text: string, opts: Record<string, unknown> = {}): Record<string, unknown> {
  return { text, fontSize: 7, margin: [2, 1, 2, 1], ...opts };
}

/**
 * 估價單報表格式 — 中一刀紙張 (241mm × 140mm)
 *
 * 與銷貨單類似但：無公司表頭、標題為「估價單」、無簽名欄
 */
export const quotationFormat: ReportFormatFn = (rawData) => {
  const data = rawData as unknown as QuotationData;
  const customer = data.customer ?? {};
  const docInfo = data.docInfo ?? {};
  const items = data.items ?? [];
  const totals = data.totals ?? {};

  const content: unknown[] = [];

  // ── 客戶資訊區 (6 欄 table: label/value × 3) ──
  // Row 1: 公司名稱 / 公司編碼 / 單據日期
  // Row 2: 統一編號 / 電話號碼 / (空)
  // Row 3: 發票地址 / 收款方式 / 單據號碼
  // Row 4: 送貨地址 / (空) / 發票號碼
  const customerInfoBody = [
    [
      labelCell('公司名稱'),
      valueCell(customer.companyName ?? ''),
      labelCell('公司編碼'),
      valueCell(customer.companyCode ?? ''),
      labelCell('日　　期'),
      valueCell(docInfo.date ?? ''),
    ],
    [
      labelCell('統一編號'),
      valueCell(customer.taxId ?? ''),
      labelCell('電　　話'),
      valueCell(customer.phone ?? ''),
      labelCell(''),
      valueCell(''),
    ],
    [
      labelCell('發票地址'),
      valueCell(customer.invoiceAddress ?? ''),
      labelCell('收款方式'),
      valueCell(customer.paymentMethod ?? ''),
      labelCell('單　　號'),
      valueCell(docInfo.docNumber ?? ''),
    ],
    [
      labelCell('送貨地址'),
      valueCell(customer.shippingAddress ?? ''),
      labelCell(''),
      valueCell(''),
      labelCell('發票號碼'),
      valueCell(docInfo.invoiceNumber ?? ''),
    ],
  ];

  content.push({
    margin: [0, 0, 0, 3],
    table: {
      widths: [38, '*', 38, 70, 38, 70],
      body: customerInfoBody,
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => BORDER_COLOR,
      vLineColor: () => BORDER_COLOR,
    },
  });

  // ── 明細表格 (9 欄) ──
  const detailWidths = [55, '*', 28, 22, 35, 38, 45, 38, 42];

  const detailHeaderRow = [
    headerCell('英文品名'),
    headerCell('貨品名稱'),
    headerCell('數量'),
    headerCell('單位'),
    headerCell('規格'),
    headerCell('單價'),
    headerCell('金額'),
    headerCell('批號'),
    headerCell('有效日期'),
  ];

  const detailBody: unknown[][] = [detailHeaderRow];

  for (const item of items) {
    detailBody.push([
      cell(item.englishName ?? ''),
      cell(item.productName ?? ''),
      cell(fmt(item.qty), { alignment: 'right' }),
      cell(item.unit ?? '', { alignment: 'center' }),
      cell(item.spec ?? '', { alignment: 'center' }),
      cell(fmt(item.unitPrice), { alignment: 'right' }),
      cell(fmt(item.amount), { alignment: 'right' }),
      cell(item.lotNumber ?? '', { alignment: 'center' }),
      cell(item.expiryDate ?? '', { alignment: 'center' }),
    ]);
  }

  // 填充空行到至少有一定高度
  const minRows = 8;
  while (detailBody.length - 1 < minRows) {
    detailBody.push(Array.from({ length: 9 }, () => cell('')));
  }

  content.push({
    margin: [0, 0, 0, 3],
    table: {
      headerRows: 1,
      widths: detailWidths,
      body: detailBody,
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => BORDER_COLOR,
      vLineColor: () => BORDER_COLOR,
    },
  });

  // ── 合計區 ──
  const totalsBody = [
    [
      { text: '貨單總計', fontSize: 7, bold: true, alignment: 'right' as const, margin: [0, 1, 4, 1] },
      { text: fmt(totals.subtotal), fontSize: 7, alignment: 'right' as const, margin: [0, 1, 4, 1] },
      { text: '溢收', fontSize: 7, bold: true, alignment: 'right' as const, margin: [0, 1, 4, 1] },
      { text: fmt(totals.overpayment), fontSize: 7, alignment: 'right' as const, margin: [0, 1, 4, 1] },
      { text: '折讓', fontSize: 7, bold: true, alignment: 'right' as const, margin: [0, 1, 4, 1] },
      { text: fmt(totals.discount), fontSize: 7, alignment: 'right' as const, margin: [0, 1, 4, 1] },
      { text: '應收合計', fontSize: 9, bold: true, alignment: 'right' as const, margin: [0, 0, 4, 0] },
      { text: fmt(totals.totalDue), fontSize: 9, bold: true, alignment: 'right' as const, margin: [0, 0, 4, 0] },
    ],
  ];

  content.push({
    margin: [0, 0, 0, 0],
    table: {
      widths: ['auto', 55, 'auto', 45, 'auto', 45, 'auto', '*'],
      body: totalsBody,
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => BORDER_COLOR,
      vLineColor: () => BORDER_COLOR,
    },
  });

  return {
    pageSize: 'HALF_CUT',
    pageOrientation: 'landscape',
    pageMargins: [15, 40, 15, 10],
    header: (currentPage: number, pageCount: number) => ({
      margin: [15, 10, 15, 0],
      columns: [
        { width: '*', text: '' },
        {
          width: 'auto',
          text: '估  價  單',
          fontSize: 16,
          bold: true,
          alignment: 'center' as const,
          margin: [0, 0, 0, 0],
        },
        {
          width: '*',
          text: `第 ${currentPage} / ${pageCount} 頁`,
          fontSize: 7,
          alignment: 'right' as const,
          margin: [0, 8, 0, 0],
        },
      ],
    }),
    content,
    defaultStyle: {
      fontSize: 7,
    },
  };
};
