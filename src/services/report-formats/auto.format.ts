import type { ReportFormatFn } from './types';

/**
 * 自動排版格式 — 智能偵測 JSON 結構，自動產生報表
 *
 * 支援的資料結構：
 * - title: 報表標題
 * - subtitle: 副標題
 * - header / info: 表頭資訊（物件 → key-value 兩欄）
 * - items / rows / data / details / lines: 明細（陣列 → 自動表格）
 * - summary / totals / footer: 合計區塊
 * - 其他欄位自動歸入「其他資訊」區
 */
const ARRAY_KEYS = ['items', 'rows', 'data', 'details', 'lines', 'records'];
const HEADER_KEYS = ['header', 'info', 'customer', 'vendor', 'supplier', 'partner', 'company_info', 'order_info'];
const SUMMARY_KEYS = ['summary', 'totals', 'footer', 'total_info'];
const SKIP_KEYS = ['title', 'subtitle', 'pageSize', 'pageOrientation', 'date', 'report_date', 'number', 'order_number', 'doc_number'];

function isArrayOfObjects(val: unknown): val is Record<string, unknown>[] {
  return Array.isArray(val) && val.length > 0 && typeof val[0] === 'object' && val[0] !== null;
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return val.toLocaleString();
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (val instanceof Date) return val.toLocaleDateString();
  return String(val);
}

function findKey(data: Record<string, unknown>, candidates: readonly string[]): string | undefined {
  return candidates.find(k => k in data);
}

function buildKeyValueRows(obj: Record<string, unknown>): unknown[][] {
  return Object.entries(obj).map(([k, v]) => [
    { text: k, bold: true, color: '#333333' },
    { text: formatValue(v) },
  ]);
}

function buildTable(items: Record<string, unknown>[]): unknown {
  const columns = Object.keys(items[0]);

  const isNumericColumn = columns.map(col =>
    items.every(row => {
      const v = row[col];
      return v === null || v === undefined || typeof v === 'number';
    })
  );

  const headerRow = columns.map(col => ({
    text: col,
    bold: true,
    color: '#ffffff',
    fillColor: '#4472C4',
    alignment: 'center' as const,
    margin: [4, 6, 4, 6],
  }));

  const bodyRows = items.map((row, rowIdx) =>
    columns.map((col, colIdx) => ({
      text: formatValue(row[col]),
      alignment: isNumericColumn[colIdx] ? ('right' as const) : ('left' as const),
      margin: [4, 3, 4, 3],
      fillColor: rowIdx % 2 === 0 ? '#F2F7FB' : undefined,
    }))
  );

  const colWidths = columns.map((col, i) => {
    if (isNumericColumn[i]) return 'auto';
    if (columns.length <= 4) return '*';
    return 'auto';
  });

  // Ensure at least one column fills remaining space
  if (!colWidths.includes('*') && colWidths.length > 0) {
    colWidths[0] = '*';
  }

  return {
    table: {
      headerRows: 1,
      widths: colWidths,
      body: [headerRow, ...bodyRows],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#CCCCCC',
      vLineColor: () => '#CCCCCC',
    },
  };
}

function buildSummaryBlock(obj: Record<string, unknown>): unknown {
  const rows = Object.entries(obj).map(([k, v]) => [
    { text: '' },
    { text: k, bold: true, alignment: 'right' as const },
    { text: formatValue(v), bold: true, alignment: 'right' as const },
  ]);

  return {
    margin: [0, 8, 0, 0],
    table: {
      widths: ['*', 'auto', 'auto'],
      body: rows,
    },
    layout: 'noBorders',
  };
}

export const autoFormat: ReportFormatFn = (data) => {
  const content: unknown[] = [];
  const usedKeys = new Set<string>();

  // --- Title ---
  const title = data.title ?? data.report_name ?? data.name;
  if (title) {
    content.push({
      text: String(title),
      style: 'reportTitle',
      margin: [0, 0, 0, 4],
    });
    usedKeys.add('title');
    usedKeys.add('report_name');
    usedKeys.add('name');
  }

  // --- Subtitle / date / number ---
  const subtitleParts: string[] = [];
  if (data.subtitle) { subtitleParts.push(String(data.subtitle)); usedKeys.add('subtitle'); }
  if (data.number ?? data.order_number ?? data.doc_number) {
    const num = data.number ?? data.order_number ?? data.doc_number;
    subtitleParts.push(String(num));
    usedKeys.add('number'); usedKeys.add('order_number'); usedKeys.add('doc_number');
  }
  if (data.date ?? data.report_date) {
    const d = data.date ?? data.report_date;
    subtitleParts.push(String(d));
    usedKeys.add('date'); usedKeys.add('report_date');
  }

  if (subtitleParts.length > 0) {
    content.push({
      text: subtitleParts.join('  |  '),
      style: 'subtitle',
      margin: [0, 0, 0, 12],
    });
  }

  // --- Header / Info block ---
  for (const key of HEADER_KEYS) {
    if (key in data && typeof data[key] === 'object' && data[key] !== null && !Array.isArray(data[key])) {
      content.push({
        margin: [0, 0, 0, 12],
        table: {
          widths: ['auto', '*'],
          body: buildKeyValueRows(data[key] as Record<string, unknown>),
        },
        layout: 'noBorders',
      });
      usedKeys.add(key);
    }
  }

  // --- Main table(s) ---
  for (const key of ARRAY_KEYS) {
    if (key in data && isArrayOfObjects(data[key])) {
      const table = buildTable(data[key] as Record<string, unknown>[]);
      content.push(Object.assign({ margin: [0, 4, 0, 4] }, table));
      usedKeys.add(key);
    }
  }

  // --- Summary / Totals ---
  for (const key of SUMMARY_KEYS) {
    if (key in data && typeof data[key] === 'object' && data[key] !== null && !Array.isArray(data[key])) {
      content.push(buildSummaryBlock(data[key] as Record<string, unknown>));
      usedKeys.add(key);
    }
  }

  // Single total value
  if ('total' in data && (typeof data.total === 'number' || typeof data.total === 'string')) {
    content.push({
      margin: [0, 8, 0, 0],
      table: {
        widths: ['*', 'auto', 'auto'],
        body: [[
          { text: '' },
          { text: '合計', bold: true, alignment: 'right' as const, fontSize: 12 },
          { text: formatValue(data.total), bold: true, alignment: 'right' as const, fontSize: 12 },
        ]],
      },
      layout: 'noBorders',
    });
    usedKeys.add('total');
  }

  // --- Remaining fields → "其他資訊" ---
  SKIP_KEYS.forEach(k => usedKeys.add(k));
  const remaining = Object.entries(data).filter(([k]) => !usedKeys.has(k));

  // Remaining arrays of objects
  for (const [key, val] of remaining) {
    if (isArrayOfObjects(val)) {
      content.push(
        { text: key, bold: true, fontSize: 11, margin: [0, 12, 0, 4] as const },
        buildTable(val as Record<string, unknown>[]),
      );
      usedKeys.add(key);
    }
  }

  // Remaining objects
  for (const [key, val] of remaining) {
    if (!usedKeys.has(key) && typeof val === 'object' && val !== null && !Array.isArray(val)) {
      content.push(
        { text: key, bold: true, fontSize: 11, margin: [0, 12, 0, 4] as const },
        {
          table: {
            widths: ['auto', '*'],
            body: buildKeyValueRows(val as Record<string, unknown>),
          },
          layout: 'noBorders',
        },
      );
      usedKeys.add(key);
    }
  }

  // Remaining scalars
  const scalarRemaining = Object.entries(data).filter(
    ([k, v]) => !usedKeys.has(k) && (typeof v !== 'object' || v === null)
  );
  if (scalarRemaining.length > 0) {
    content.push(
      { text: '', margin: [0, 8, 0, 0] as const },
      {
        table: {
          widths: ['auto', '*'],
          body: scalarRemaining.map(([k, v]) => [
            { text: k, bold: true, color: '#333333' },
            { text: formatValue(v) },
          ]),
        },
        layout: 'noBorders',
      },
    );
  }

  const pageSize = (typeof data.pageSize === 'string' ? data.pageSize : undefined) ?? 'A4';
  const pageOrientation = (data.pageOrientation === 'landscape' ? 'landscape' : 'portrait') as 'portrait' | 'landscape';

  return {
    pageSize,
    pageOrientation,
    pageMargins: [40, 60, 40, 60],
    content,
    styles: {
      reportTitle: {
        fontSize: 18,
        bold: true,
        color: '#1F3864',
      },
      subtitle: {
        fontSize: 11,
        color: '#666666',
      },
    },
    defaultStyle: {
      fontSize: 10,
    },
  };
};
