import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { generateReport } from '../services/report.service';
import { printPdfBuffer } from '../services/printer.service';
import { createJob, updateJobStatus } from '../services/job-queue.service';
import { reportRequestSchema } from '../validators/report.validator';
import { config } from '../config';
import type { ReportDefinition } from '../models/report-definition.model';

const router = Router();

/** POST /api/report - Generate a report from JSON definition */
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = reportRequestSchema.parse(req.body);
    const pdfBuffer = await generateReport(parsed.definition as ReportDefinition);

    if (parsed.action === 'download') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="report.pdf"');
      return res.send(pdfBuffer);
    }

    if (parsed.action === 'print') {
      const job = createJob({
        printer: parsed.printer || '(system default)',
        mode: 'pdf',
        copies: parsed.copies,
        paperSize: typeof parsed.definition.pageSize === 'string' ? parsed.definition.pageSize : 'custom',
        source: 'api:report',
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

    // preview: save PDF and return URL
    const previewId = uuidv4();
    const previewPath = path.join(config.outputDir, `preview-${previewId}.pdf`);
    fs.writeFileSync(previewPath, pdfBuffer);

    // Auto-cleanup after 1 hour
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
