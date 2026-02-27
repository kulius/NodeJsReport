import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { generateReport } from '../services/report.service';
import { printPdfBuffer } from '../services/printer.service';
import { createJob, updateJobStatus } from '../services/job-queue.service';
import { getFormat, listFormats } from '../services/report-formats';
import { generateRequestSchema } from '../validators/generate.validator';
import { config } from '../config';

/** Schema 檔案目錄 */
const schemasDir = path.join(config.dataDir, 'schemas');

const router = Router();

/**
 * GET /api/generate/formats
 * 列出所有可用的報表格式
 */
router.get('/formats', (_req: Request, res: Response) => {
  res.json({ success: true, data: listFormats() });
});

/**
 * GET /api/generate/schema/:formatId
 * 取得報表格式的 JSON Schema（給其他 AI 讀取用）
 */
router.get('/schema/:formatId', (req: Request, res: Response) => {
  const formatId = String(req.params.formatId);

  // 防止 path traversal：只允許英數、底線、連字號
  if (!/^[a-zA-Z0-9_-]+$/.test(formatId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid formatId: only alphanumeric, underscore, and hyphen allowed',
    });
  }

  const schemaPath = path.join(schemasDir, `${formatId}.schema.json`);

  if (!fs.existsSync(schemaPath)) {
    return res.status(404).json({
      success: false,
      error: `Schema not found for format: "${formatId}"`,
    });
  }

  try {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    res.json({ success: true, data: schema });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: `Failed to read schema: ${msg}` });
  }
});

/**
 * POST /api/generate
 *
 * 外部系統只送 JSON 資料，自動產生報表並列印/預覽
 *
 * Body:
 *   reportType: "auto" (預設) 或已註冊的格式 ID
 *   data: { ... }  ← 原始業務資料
 *   action: "print" (預設) | "preview" | "download"
 *   printer: "印表機名稱" (選填)
 *   copies: 1 (選填)
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = generateRequestSchema.parse(req.body);

    // 1. 找到報表格式
    const formatFn = getFormat(parsed.reportType);
    if (!formatFn) {
      const available = listFormats().map(f => f.id);
      return res.status(400).json({
        success: false,
        error: `Unknown reportType: "${parsed.reportType}". Available: ${available.join(', ')}`,
      });
    }

    // 2. 資料 → pdfmake definition
    const definition = formatFn(parsed.data);

    // 3. definition → PDF buffer
    const pdfBuffer = await generateReport(definition);

    // 4. 依 action 處理
    if (parsed.action === 'print') {
      const job = createJob({
        printer: parsed.printer || '(system default)',
        mode: 'pdf',
        copies: parsed.copies,
        paperSize: typeof definition.pageSize === 'string' ? definition.pageSize : 'custom',
        source: `generate:${parsed.reportType}`,
      });

      updateJobStatus(job.id, 'printing');

      const result = await printPdfBuffer(pdfBuffer, {
        printer: parsed.printer,
        copies: parsed.copies,
      });

      updateJobStatus(job.id, 'completed');

      return res.json({
        success: true,
        action: 'print',
        jobId: result.jobId,
        printer: result.printer,
      });
    }

    if (parsed.action === 'download') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="report.pdf"');
      return res.send(pdfBuffer);
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
      action: 'preview',
      previewId,
      previewUrl: `/api/preview/${previewId}`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(400).json({ success: false, error: msg });
  }
});

export default router;
