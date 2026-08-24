import { generateReport } from "./reportGenerator";

/**
 * Background report generation. A full generate (GSC pulls, SE Ranking, an
 * LLM commentary draft) can outlive an HTTP request behind the proxy, which
 * showed up as "Generating…" forever. POST starts the job, the panel polls
 * its status and sees the generator's own log lines as live progress.
 */

export interface GenerateJob {
  startedAt: string;
  finished: boolean;
  ok?: boolean;
  message?: string;
  reportUrl?: string;
  log: string[];
}

const jobs = new Map<string, GenerateJob>();

const key = (clientKey: string, periodKey: string) => `${clientKey}:${periodKey}`;

export function generateJobStatus(clientKey: string, periodKey: string): GenerateJob | null {
  return jobs.get(key(clientKey, periodKey)) ?? null;
}

export function startGenerateJob(clientKey: string, periodKey: string): { ok: boolean; message: string } {
  const existing = jobs.get(key(clientKey, periodKey));
  if (existing && !existing.finished) {
    return { ok: true, message: "Already generating — progress shows below." };
  }
  const job: GenerateJob = { startedAt: new Date().toISOString(), finished: false, log: [] };
  jobs.set(key(clientKey, periodKey), job);
  generateReport({ clientKey, periodKey, log: (m) => job.log.push(m) })
    .then(({ snapshot }) => {
      job.finished = true;
      job.ok = true;
      job.message = `Report generated for ${snapshot.client.client_name}, ${snapshot.period.label} (${snapshot.dataSource} data).`;
      job.reportUrl = `/reports/${clientKey}/${periodKey}`;
    })
    .catch((error) => {
      job.finished = true;
      job.ok = false;
      job.message = error instanceof Error ? error.message : "Report generation failed.";
    });
  return { ok: true, message: "Generation started." };
}
