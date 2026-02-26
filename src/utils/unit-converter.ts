/** 1 inch = 72 PDF points */
const PT_PER_INCH = 72;
/** 1 inch = 25.4 mm */
const MM_PER_INCH = 25.4;

/** mm -> PDF points */
export function mmToPt(mm: number): number {
  return (mm / MM_PER_INCH) * PT_PER_INCH;
}

/** PDF points -> mm */
export function ptToMm(pt: number): number {
  return (pt / PT_PER_INCH) * MM_PER_INCH;
}

/** inch -> PDF points */
export function inchToPt(inch: number): number {
  return inch * PT_PER_INCH;
}

/** PDF points -> inch */
export function ptToInch(pt: number): number {
  return pt / PT_PER_INCH;
}

/** mm -> inch */
export function mmToInch(mm: number): number {
  return mm / MM_PER_INCH;
}
