import { z } from 'zod';

const tableColumnSchema = z.object({
  field: z.string(),
  header: z.string().optional(),
  width: z.number().positive(),
  align: z.enum(['left', 'center', 'right']).optional(),
});

const templateFieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['text', 'table', 'image', 'barcode']),
  x: z.number().min(0),
  y: z.number().min(0),
  fontSize: z.number().positive().optional(),
  fontFamily: z.string().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  letterSpacing: z.number().optional(),
  maxWidth: z.number().positive().optional(),
  columns: z.array(tableColumnSchema).optional(),
  rowHeight: z.number().positive().optional(),
  maxRows: z.number().int().positive().optional(),
});

export const createTemplateSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'ID must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1),
  paperSize: z.string().default('A4'),
  backgroundPdf: z.string().optional(),
  showBackground: z.boolean().default(false),
  defaultFont: z.object({
    family: z.string().default('NotoSansTC'),
    size: z.number().positive().default(11),
  }).default({ family: 'NotoSansTC', size: 11 }),
  fields: z.array(templateFieldSchema).default([]),
});

export const updateTemplateSchema = createTemplateSchema.partial().omit({ id: true });

export type CreateTemplateRequest = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateRequest = z.infer<typeof updateTemplateSchema>;
