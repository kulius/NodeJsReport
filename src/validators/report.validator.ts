import { z } from 'zod';

export const reportRequestSchema = z.object({
  definition: z.object({
    pageSize: z.union([
      z.string(),
      z.object({ width: z.number(), height: z.number() }),
    ]).default('A4'),
    pageMargins: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    pageOrientation: z.enum(['portrait', 'landscape']).optional(),
    header: z.unknown().optional(),
    footer: z.unknown().optional(),
    content: z.unknown(),
    styles: z.record(z.unknown()).optional(),
    defaultStyle: z.record(z.unknown()).optional(),
  }),
  action: z.enum(['preview', 'print', 'download']).default('preview'),
  printer: z.string().optional(),
  copies: z.number().int().min(1).max(100).default(1),
});

export type ReportRequest = z.infer<typeof reportRequestSchema>;
