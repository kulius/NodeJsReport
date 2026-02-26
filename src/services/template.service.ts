import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { OverlayTemplate } from '../models/template.model';

let templates: OverlayTemplate[] = [];

/** Load all templates from disk */
export function loadTemplates(): void {
  templates = [];
  const dir = config.templatesDir;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      const tmpl = JSON.parse(raw) as OverlayTemplate;
      templates = [...templates, tmpl];
    } catch (error) {
      logger.error({ error, file }, 'Failed to load template');
    }
  }

  logger.info({ count: templates.length }, 'Templates loaded');
}

/** Get all templates */
export function getAllTemplates(): OverlayTemplate[] {
  return templates;
}

/** Get a template by ID */
export function getTemplate(id: string): OverlayTemplate | undefined {
  return templates.find((t) => t.id === id);
}

/** Create a new template */
export function createTemplate(data: Omit<OverlayTemplate, 'createdAt' | 'updatedAt'>): OverlayTemplate {
  const existing = getTemplate(data.id);
  if (existing) {
    throw new Error(`Template '${data.id}' already exists`);
  }

  const now = new Date().toISOString();
  const template: OverlayTemplate = {
    ...data,
    createdAt: now,
    updatedAt: now,
  };

  saveTemplateToDisk(template);
  templates = [...templates, template];
  logger.info({ id: template.id }, 'Template created');
  return template;
}

/** Update an existing template */
export function updateTemplate(
  id: string,
  updates: Partial<Omit<OverlayTemplate, 'id' | 'createdAt' | 'updatedAt'>>
): OverlayTemplate | undefined {
  const existing = getTemplate(id);
  if (!existing) return undefined;

  const updated: OverlayTemplate = {
    ...existing,
    ...updates,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };

  saveTemplateToDisk(updated);
  templates = templates.map((t) => (t.id === id ? updated : t));
  logger.info({ id }, 'Template updated');
  return updated;
}

/** Delete a template */
export function deleteTemplate(id: string): boolean {
  const existing = getTemplate(id);
  if (!existing) return false;

  const filePath = path.join(config.templatesDir, `${id}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  templates = templates.filter((t) => t.id !== id);
  logger.info({ id }, 'Template deleted');
  return true;
}

function saveTemplateToDisk(template: OverlayTemplate): void {
  const filePath = path.join(config.templatesDir, `${template.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(template, null, 2), 'utf-8');
}
