import { Router, Request, Response } from 'express';
import { listPrinters } from '../services/printer.service';

const router = Router();

/** GET /api/printers - List available printers */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const printers = await listPrinters();
    res.json({ success: true, data: printers });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
