import { Router, Request, Response } from 'express';
import { startWatcher, stopWatcher, getWatcherStatus } from '../services/watcher.service';
import { z } from 'zod';

const router = Router();

const startWatcherSchema = z.object({
  directory: z.string().min(1),
  printer: z.string().optional(),
  paperSize: z.string().default('A4'),
  moveAfterPrint: z.boolean().default(true),
});

/** POST /api/watcher/start - Start directory watching */
router.post('/start', (req: Request, res: Response) => {
  try {
    const parsed = startWatcherSchema.parse(req.body);
    const status = startWatcher({
      directory: parsed.directory,
      printer: parsed.printer,
      paperSize: parsed.paperSize,
      moveAfterPrint: parsed.moveAfterPrint,
    });
    res.json({ success: true, data: status });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(400).json({ success: false, error: msg });
  }
});

/** POST /api/watcher/stop - Stop directory watching */
router.post('/stop', (_req: Request, res: Response) => {
  stopWatcher();
  res.json({ success: true, data: getWatcherStatus() });
});

/** GET /api/watcher/status - Get watcher status */
router.get('/status', (_req: Request, res: Response) => {
  res.json({ success: true, data: getWatcherStatus() });
});

export default router;
