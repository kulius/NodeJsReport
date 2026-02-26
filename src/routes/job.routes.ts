import { Router, Request, Response } from 'express';
import { getAllJobs, getJob, getQueueStats } from '../services/job-queue.service';

const router = Router();

/** GET /api/jobs - List recent print jobs */
router.get('/', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const jobs = getAllJobs(limit);
  const stats = getQueueStats();
  res.json({ success: true, data: jobs, stats });
});

/** GET /api/jobs/:id - Get a specific job */
router.get('/:id', (req: Request, res: Response) => {
  const job = getJob(String(req.params.id));
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }
  res.json({ success: true, data: job });
});

export default router;
