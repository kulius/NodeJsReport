import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { excelToPdf, readExcelData } from '../services/excel.service';
import { printPdfBuffer } from '../services/printer.service';
import { createJob, updateJobStatus } from '../services/job-queue.service';

const router = Router();

const upload = multer({
  dest: config.uploadsDir,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xls' || ext === '.xlsx') {
      cb(null, true);
    } else {
      cb(new Error('Only XLS/XLSX files are allowed'));
    }
  },
});

/** POST /api/excel/print - Upload Excel and print */
router.post('/print', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const paperSize = (req.body.paperSize as string) || 'A4';
    const printer = req.body.printer as string | undefined;

    const pdfBuffer = await excelToPdf(req.file.path, { paperSize });

    const job = createJob({
      printer: printer || '(system default)',
      mode: 'pdf',
      copies: 1,
      paperSize,
      source: `api:excel:${req.file.originalname}`,
    });

    updateJobStatus(job.id, 'printing');

    const result = await printPdfBuffer(pdfBuffer, { printer, paperSize });

    updateJobStatus(job.id, 'completed');

    // Clean up uploaded file
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }

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

/** POST /api/excel/preview - Upload Excel and preview as PDF */
router.post('/preview', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const paperSize = (req.body.paperSize as string) || 'A4';

    const pdfBuffer = await excelToPdf(req.file.path, { paperSize });

    const previewId = uuidv4();
    const previewPath = path.join(config.outputDir, `preview-${previewId}.pdf`);
    fs.writeFileSync(previewPath, pdfBuffer);

    // Auto-cleanup
    setTimeout(() => {
      try { if (fs.existsSync(previewPath)) fs.unlinkSync(previewPath); } catch { /* ignore */ }
    }, 60 * 60 * 1000);

    // Clean up uploaded file
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }

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

/** POST /api/excel/data - Upload Excel and return data (for preview without PDF) */
router.post('/data', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const data = await readExcelData(req.file.path);

    // Clean up uploaded file
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }

    res.json({ success: true, data });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(400).json({ success: false, error: msg });
  }
});

export default router;
