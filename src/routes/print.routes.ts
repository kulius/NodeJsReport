import { Router, Request, Response } from 'express';
import { printPdfBuffer } from '../services/printer.service';
import { createJob, updateJobStatus } from '../services/job-queue.service';
import { printRequestSchema } from '../validators/print.validator';
import { base64ToBuffer } from '../utils/pdf-helpers';

const router = Router();

/** POST /api/print - Print a PDF (base64 encoded) */
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = printRequestSchema.parse(req.body);

    if (parsed.mode === 'escp') {
      // ESC/P mode is handled separately
      return res.status(400).json({
        success: false,
        error: 'ESC/P mode requires POST /api/print/escp endpoint',
      });
    }

    const pdfBuffer = base64ToBuffer(parsed.pdf);

    const job = createJob({
      printer: parsed.printer || '(system default)',
      mode: 'pdf',
      copies: parsed.copies,
      paperSize: parsed.paperSize,
      source: 'api:print',
    });

    updateJobStatus(job.id, 'printing');

    const result = await printPdfBuffer(pdfBuffer, {
      printer: parsed.printer,
      copies: parsed.copies,
      paperSize: parsed.paperSize,
      silent: parsed.silent,
    });

    updateJobStatus(job.id, 'completed');

    res.json({
      success: true,
      jobId: result.jobId,
      printer: result.printer,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(400).json({ success: false, error: msg });
  }
});

export default router;
