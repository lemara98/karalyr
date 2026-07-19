import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { apiError, json } from "@/lib/api-helpers";
import { failJob } from "@/lib/sync-queue/core";
import { isWorkerRequest } from "@/lib/worker-auth";

const bodySchema = z.object({
  worker_id: z.string().min(1).max(100),
  // Clamped, not rejected — workers send whatever traceback they have.
  error: z.string().min(1).transform((s) => s.slice(0, 2000)),
  permanent: z.boolean().default(false),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isWorkerRequest(req)) return apiError(401, "Unauthorized", "Worker token required");

  const { id } = await params;
  const jobId = parseInt(id, 10);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return apiError(400, "BadRequest", "Job id must be a positive integer");
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const message = e instanceof z.ZodError ? e.issues[0]?.message : "Invalid JSON body";
    return apiError(400, "BadRequest", message ?? "Invalid request body");
  }

  const job = await failJob(getDb(), jobId, body.worker_id, body.error, body.permanent);
  if (!job) return apiError(409, "NotOwner", "Job is not processing under this worker");

  // "queued" (will retry after backoff) or "failed" (buried).
  return json({ status: job.status });
}
