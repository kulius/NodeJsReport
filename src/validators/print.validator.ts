import { z } from 'zod';

export const printRequestSchema = z.object({
  pdf: z.string().min(1, 'PDF base64 data is required'),
  printer: z.string().optional(),
  copies: z.number().int().min(1).max(100).default(1),
  paperSize: z.string().default('A4'),
  silent: z.boolean().default(true),
  mode: z.enum(['pdf', 'escp']).default('pdf'),
});

export type PrintRequest = z.infer<typeof printRequestSchema>;
