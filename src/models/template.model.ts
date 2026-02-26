export type FieldType = 'text' | 'table' | 'image' | 'barcode';
export type TextAlign = 'left' | 'center' | 'right';

export interface TemplateField {
  readonly name: string;
  readonly type: FieldType;
  readonly x: number;       // PDF points from left
  readonly y: number;       // PDF points from bottom
  readonly fontSize?: number;
  readonly fontFamily?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly align?: TextAlign;
  readonly letterSpacing?: number;
  readonly maxWidth?: number;
  readonly columns?: readonly TableColumn[];
  readonly rowHeight?: number;
  readonly maxRows?: number;
}

export interface TableColumn {
  readonly field: string;
  readonly header?: string;
  readonly width: number;
  readonly align?: TextAlign;
}

export interface OverlayTemplate {
  readonly id: string;
  readonly name: string;
  readonly paperSize: string;
  readonly backgroundPdf?: string;
  readonly showBackground: boolean;
  readonly defaultFont: {
    readonly family: string;
    readonly size: number;
  };
  readonly fields: readonly TemplateField[];
  readonly createdAt: string;
  readonly updatedAt: string;
}
