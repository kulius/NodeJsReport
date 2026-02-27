import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { generateReport } from '../services/report.service';
import { printPdfBuffer } from '../services/printer.service';
import { sendEscpToLocalPrinter } from '../services/escp.service';
import { createJob, updateJobStatus } from '../services/job-queue.service';
import { getFormat, getEscpFormat, getSchema, listFormats } from '../services/report-formats';
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

  // 1. 優先從 registry 內嵌 schema 讀取（exe 打包後也能用）
  const embedded = getSchema(formatId);
  if (embedded) {
    return res.json({ success: true, data: embedded });
  }

  // 2. Fallback: 從 data/schemas/ 外部檔案讀取
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
 *   mode: "pdf" (預設) | "escp"
 *   printer: "印表機名稱" (選填)
 *   copies: 1 (選填)
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = generateRequestSchema.parse(req.body);

    // ── ESC/P debug 模式：產生 .prn 檔案下載（不送印） ──
    if (parsed.mode === 'escp_debug') {
      const escpFn = getEscpFormat(parsed.reportType);
      if (!escpFn) {
        const available = listFormats().filter(f => f.hasEscp).map(f => f.id);
        return res.status(400).json({
          success: false,
          error: `No ESC/P format for "${parsed.reportType}". Available: ${available.join(', ') || '(none)'}`,
        });
      }

      const escpBuffer = escpFn(parsed.data);
      const filename = `${parsed.reportType}-debug.prn`;

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(escpBuffer);
    }

    // ── ESC/P 模式：直接送 raw bytes 到點陣印表機 ──
    if (parsed.mode === 'escp') {
      const escpFn = getEscpFormat(parsed.reportType);
      if (!escpFn) {
        const available = listFormats().filter(f => f.hasEscp).map(f => f.id);
        return res.status(400).json({
          success: false,
          error: `No ESC/P format for "${parsed.reportType}". Available: ${available.join(', ') || '(none)'}`,
        });
      }

      // ESC/P 只支援 print（不支援 preview/download，因為不是 PDF）
      if (parsed.action !== 'print') {
        return res.status(400).json({
          success: false,
          error: 'ESC/P mode only supports action="print". Use mode="pdf" for preview/download.',
        });
      }

      const escpBuffer = escpFn(parsed.data);
      const printerName = parsed.printer || 'EPSON LQ-690CIIN ESC/P2';

      const job = createJob({
        printer: printerName,
        mode: 'escp',
        copies: parsed.copies,
        paperSize: 'continuous',
        source: `generate:${parsed.reportType}:escp`,
      });

      updateJobStatus(job.id, 'printing');

      try {
        // 多份列印：重複送出 buffer
        for (let i = 0; i < parsed.copies; i++) {
          await sendEscpToLocalPrinter(escpBuffer, printerName);
        }
        updateJobStatus(job.id, 'completed');
      } catch (err) {
        updateJobStatus(job.id, 'failed');
        throw err;
      }

      return res.json({
        success: true,
        action: 'print',
        mode: 'escp',
        jobId: job.id,
        printer: printerName,
        bytes: escpBuffer.length,
      });
    }

    // ── PDF 模式（原有邏輯） ──

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
