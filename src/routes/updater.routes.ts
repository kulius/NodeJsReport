import { Router, Request, Response } from 'express';
import { checkForUpdate, getUpdateStatus, applyUpdate } from '../services/updater.service';

const router = Router();

/** GET /api/updater/check - Check for updates from GitHub Releases */
router.get('/check', async (_req: Request, res: Response) => {
  try {
    const result = await checkForUpdate();
    res.json({ success: true, data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

/** GET /api/updater/status - Current version + last check info */
router.get('/status', (_req: Request, res: Response) => {
  try {
    const status = getUpdateStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

/** POST /api/updater/apply - Download and apply update (restarts service) */
router.post('/apply', async (req: Request, res: Response) => {
  try {
    const { downloadUrl, version } = req.body;

    if (!downloadUrl || !version) {
      return res.status(400).json({
        success: false,
        error: 'downloadUrl and version are required',
      });
    }

    const result = await applyUpdate(downloadUrl, version);
    res.json({ success: true, data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
