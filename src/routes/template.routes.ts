import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { config } from '../config';
import {
  getAllTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../services/template.service';
import { createTemplateSchema, updateTemplateSchema } from '../validators/template.validator';

const router = Router();

const upload = multer({
  dest: config.uploadsDir,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

/** GET /api/templates - List all templates */
router.get('/', (_req: Request, res: Response) => {
  const templates = getAllTemplates();
  res.json({ success: true, data: templates });
});

/** GET /api/templates/:id - Get a template by ID */
router.get('/:id', (req: Request, res: Response) => {
  const template = getTemplate(String(req.params.id));
  if (!template) {
    return res.status(404).json({ success: false, error: 'Template not found' });
  }
  res.json({ success: true, data: template });
});

/** POST /api/templates - Create a new template */
router.post('/', (req: Request, res: Response) => {
  try {
    const data = createTemplateSchema.parse(req.body);
    const template = createTemplate(data);
    res.status(201).json({ success: true, data: template });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(400).json({ success: false, error: msg });
  }
});

/** PUT /api/templates/:id - Update a template */
router.put('/:id', (req: Request, res: Response) => {
  try {
    const updates = updateTemplateSchema.parse(req.body);
    const template = updateTemplate(String(req.params.id), updates);
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }
    res.json({ success: true, data: template });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(400).json({ success: false, error: msg });
  }
});

/** DELETE /api/templates/:id - Delete a template */
router.delete('/:id', (req: Request, res: Response) => {
  const deleted = deleteTemplate(String(req.params.id));
  if (!deleted) {
    return res.status(404).json({ success: false, error: 'Template not found' });
  }
  res.json({ success: true });
});

/** POST /api/templates/:id/background - Upload background PDF */
router.post('/:id/background', upload.single('file'), (req: Request, res: Response) => {
  try {
    const templateId = String(req.params.id);
    const template = getTemplate(templateId);
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const filename = `${templateId}-bg.pdf`;
    const fs = require('fs');
    const destPath = path.join(config.uploadsDir, filename);
    fs.renameSync(req.file.path, destPath);

    updateTemplate(templateId, { backgroundPdf: filename });

    res.json({ success: true, backgroundPdf: filename });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(400).json({ success: false, error: msg });
  }
});

export default router;
