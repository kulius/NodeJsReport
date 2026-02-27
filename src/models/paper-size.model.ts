export interface PaperSize {
  readonly id: string;
  readonly name: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly builtIn: boolean;
}

/** Built-in paper sizes */
export const BUILT_IN_PAPER_SIZES: readonly PaperSize[] = [
  { id: 'A4', name: 'A4', widthMm: 210, heightMm: 297, builtIn: true },
  { id: 'A5', name: 'A5', widthMm: 148, heightMm: 210, builtIn: true },
  { id: 'B5', name: 'B5 (JIS)', widthMm: 182, heightMm: 257, builtIn: true },
  { id: 'LETTER', name: 'Letter', widthMm: 216, heightMm: 279, builtIn: true },
  { id: 'LEGAL', name: 'Legal', widthMm: 216, heightMm: 356, builtIn: true },
  { id: 'HALF_CUT', name: '中一刀', widthMm: 241, heightMm: 140, builtIn: true },
] as const;
