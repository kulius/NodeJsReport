import { z } from 'zod';

export const overlayRequestSchema = z.object({
  templateId: z.string().min(1),
  data: z.record(z.unknown()),
  action: z.enum(['preview', 'print', 'download']).default('preview'),
  showBackground: z.boolean().default(true),
  printer: z.string().optional(),
  copies: z.number().int().min(1).max(100).default(1),
  mode: z.enum(['pdf', 'escp']).default('pdf'),
});

export type OverlayRequest = z.infer<typeof overlayRequestSchema>;
