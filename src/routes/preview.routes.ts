import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

const router = Router();

/** GET /api/preview/:id - Serve a preview PDF */
router.get('/:id', (req: Request, res: Response) => {
  const previewId = String(req.params.id);

  // Sanitize ID to prevent path traversal
  if (!/^[a-f0-9-]+$/.test(previewId)) {
    return res.status(400).json({ success: false, error: 'Invalid preview ID' });
  }

  const filePath = path.join(config.outputDir, `preview-${previewId}.pdf`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'Preview not found or expired' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(filePath);
});

export default router;
