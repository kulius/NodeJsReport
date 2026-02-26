export type PrintJobStatus = 'pending' | 'printing' | 'completed' | 'failed';
export type PrintMode = 'pdf' | 'escp';

export interface PrintJob {
  readonly id: string;
  readonly status: PrintJobStatus;
  readonly printer: string;
  readonly mode: PrintMode;
  readonly copies: number;
  readonly paperSize: string;
  readonly createdAt: Date;
  readonly completedAt?: Date;
  readonly error?: string;
  readonly source: string;
  readonly pdfPath?: string;
}
