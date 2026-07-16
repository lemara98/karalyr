import { apiError } from "@/lib/api-helpers";
import { getAlignJob, localAlignAvailable } from "@/lib/align-local";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!localAlignAvailable()) {
    return apiError(404, "NotFound", "Local alignment is not enabled on this server");
  }
  const { id } = await params;
  const job = getAlignJob(id);
  if (!job) return apiError(404, "NotFound", "No such job");

  return Response.json({
    id: job.id,
    status: job.status,
    log: job.log.slice(-30),
    result: job.result ?? null,
    error: job.error ?? null,
  });
}
