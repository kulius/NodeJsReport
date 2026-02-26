import { v4 as uuidv4 } from 'uuid';
import { type PrintJob, type PrintJobStatus, type PrintMode } from '../models/print-job.model';
import { logger } from '../utils/logger';

/** In-memory job store with 1-hour auto-expiry */
const jobs = new Map<string, PrintJob>();

const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Create a new print job */
export function createJob(params: {
  printer: string;
  mode: PrintMode;
  copies: number;
  paperSize: string;
  source: string;
  pdfPath?: string;
}): PrintJob {
  const job: PrintJob = {
    id: uuidv4(),
    status: 'pending',
    printer: params.printer,
    mode: params.mode,
    copies: params.copies,
    paperSize: params.paperSize,
    createdAt: new Date(),
    source: params.source,
    pdfPath: params.pdfPath,
  };

  jobs.set(job.id, job);
  scheduleCleanup(job.id);
  logger.info({ jobId: job.id, source: job.source }, 'Print job created');
  return job;
}

/** Update job status */
export function updateJobStatus(
  jobId: string,
  status: PrintJobStatus,
  error?: string
): PrintJob | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;

  const updated: PrintJob = {
    ...job,
    status,
    completedAt: status === 'completed' || status === 'failed' ? new Date() : undefined,
    error,
  };

  jobs.set(jobId, updated);
  logger.info({ jobId, status, error }, 'Job status updated');
  return updated;
}

/** Get a job by ID */
export function getJob(jobId: string): PrintJob | undefined {
  return jobs.get(jobId);
}

/** Get all jobs (most recent first) */
export function getAllJobs(limit = 50): PrintJob[] {
  return Array.from(jobs.values())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

/** Schedule auto-cleanup of expired jobs */
function scheduleCleanup(jobId: string): void {
  setTimeout(() => {
    if (jobs.has(jobId)) {
      jobs.delete(jobId);
      logger.debug({ jobId }, 'Expired job cleaned up');
    }
  }, JOB_TTL_MS);
}

/** Get queue stats */
export function getQueueStats() {
  const all = Array.from(jobs.values());
  return {
    total: all.length,
    pending: all.filter((j) => j.status === 'pending').length,
    printing: all.filter((j) => j.status === 'printing').length,
    completed: all.filter((j) => j.status === 'completed').length,
    failed: all.filter((j) => j.status === 'failed').length,
  };
}
