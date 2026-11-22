"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { cancelJob } from "@/lib/jobs";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Shown in place of an endless spinner once a job runs past its deadline. */
export function JobOverdueNotice({ job, className }: { job: Job; className?: string }) {
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => cancelJob(qc, job.id),
    onError: (e) => toast.error("Couldn't cancel", { description: errorMessage(e) }),
  });
  const stopping = cancel.isPending || (cancel.isSuccess && job.status === "running");
  return (
    <div role="status" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 text-sm", className)}>
      <p className="text-pretty">
        <span className="font-medium">Still working…</span>{" "}
        <span className="text-muted-foreground">This is taking longer than usual.</span>
      </p>
      <Button type="button" variant="outline" size="sm" disabled={stopping} onClick={() => cancel.mutate()}>
        {stopping ? "Cancelling…" : "Cancel"}
      </Button>
    </div>
  );
}
