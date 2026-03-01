import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

const router = Router();

/** GET /api/preview/:id - Serve a preview file (PDF or PNG) */
router.get('/:id', (req: Request, res: Response) => {
  const previewId = String(req.params.id);

  // Sanitize ID to prevent path traversal
  if (!/^[a-f0-9-]+$/.test(previewId)) {
    return res.status(400).json({ success: false, error: 'Invalid preview ID' });
  }

  // Try PNG first, then PDF
  const pngPath = path.join(config.outputDir, `preview-${previewId}.png`);
  const pdfPath = path.join(config.outputDir, `preview-${previewId}.pdf`);

  if (fs.existsSync(pngPath)) {
    res.setHeader('Content-Type', 'image/png');
    return res.sendFile(pngPath);
  }

  if (fs.existsSync(pdfPath)) {
    res.setHeader('Content-Type', 'application/pdf');
    return res.sendFile(pdfPath);
  }

  return res.status(404).json({ success: false, error: 'Preview not found or expired' });
});

export default router;
