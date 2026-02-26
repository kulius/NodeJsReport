import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { generateOverlay } from '../services/overlay.service';
import { printPdfBuffer } from '../services/printer.service';
import { createJob, updateJobStatus } from '../services/job-queue.service';
import { overlayRequestSchema } from '../validators/overlay.validator';
import { config } from '../config';

const router = Router();

/** POST /api/overlay - Generate overlay print */
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = overlayRequestSchema.parse(req.body);

    const pdfBuffer = await generateOverlay({
      templateId: parsed.templateId,
      data: parsed.data,
      showBackground: parsed.showBackground,
    });

    if (parsed.action === 'download') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="overlay.pdf"');
      return res.send(pdfBuffer);
    }

    if (parsed.action === 'print') {
      const job = createJob({
        printer: parsed.printer || '(system default)',
        mode: parsed.mode,
        copies: parsed.copies,
        paperSize: 'template',
        source: `api:overlay:${parsed.templateId}`,
      });

      updateJobStatus(job.id, 'printing');

      const result = await printPdfBuffer(pdfBuffer, {
        printer: parsed.printer,
        copies: parsed.copies,
      });

      updateJobStatus(job.id, 'completed');

      return res.json({
        success: true,
        jobId: result.jobId,
        printer: result.printer,
      });
    }

    // preview
    const previewId = uuidv4();
    const previewPath = path.join(config.outputDir, `preview-${previewId}.pdf`);
    fs.writeFileSync(previewPath, pdfBuffer);

    setTimeout(() => {
      try { if (fs.existsSync(previewPath)) fs.unlinkSync(previewPath); } catch { /* ignore */ }
    }, 60 * 60 * 1000);

    res.json({
      success: true,
      previewId,
      previewUrl: `/api/preview/${previewId}`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(400).json({ success: false, error: msg });
  }
});

export default router;
