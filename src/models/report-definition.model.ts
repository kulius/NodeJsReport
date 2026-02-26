export type ReportAction = 'preview' | 'print' | 'download';

export interface ReportDefinition {
  readonly pageSize: string | { width: number; height: number };
  readonly pageMargins?: readonly [number, number, number, number];
  readonly pageOrientation?: 'portrait' | 'landscape';
  readonly header?: unknown;
  readonly footer?: unknown;
  readonly content: unknown;
  readonly styles?: Record<string, unknown>;
  readonly defaultStyle?: Record<string, unknown>;
}
