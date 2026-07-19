import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { apiError, json } from "@/lib/api-helpers";
import { heartbeatJob } from "@/lib/sync-queue/core";
import { isWorkerRequest } from "@/lib/worker-auth";

const bodySchema = z.object({
  worker_id: z.string().min(1).max(100),
  lease_seconds: z.number().int().min(60).max(7200).default(2700),
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

  const job = await heartbeatJob(getDb(), jobId, body.worker_id, body.lease_seconds * 1000);
  if (!job) return apiError(409, "NotOwner", "Job is not processing under this worker");

  return json({ lease_expires_at: job.leaseExpiresAt });
}
