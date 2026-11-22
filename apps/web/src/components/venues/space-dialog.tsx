"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { VenueSpecFields } from "@/components/venue-spec-fields";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { VenueSpec } from "@/lib/types";

export function SpaceDialog({ venueId, open, onOpenChange }: { venueId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {open && <SpaceForm venueId={venueId} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function SpaceForm({ venueId, onDone }: { venueId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [spec, setSpec] = useState<VenueSpec>({ fixtures: [] });
  const [touched, setTouched] = useState(false);
  const invalid = touched && !name.trim();

  const create = useMutation({
    mutationFn: () => api.createSpace(venueId, { name: name.trim(), venue_spec: spec }),
    onSuccess: (space) => {
      void qc.invalidateQueries({ queryKey: qk.venue(venueId) });
      void qc.invalidateQueries({ queryKey: qk.venues });
      qc.setQueryData(qk.space(space.id), space);
      toast.success("Room added", { description: space.name });
      onDone();
      router.push(`/spaces/${space.id}`);
    },
    onError: (e) => toast.error("Couldn't add the room", { description: errorMessage(e) }),
  });

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (name.trim()) create.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle className="font-display text-3xl font-normal">Add a room</DialogTitle>
        <DialogDescription>A ballroom, a terrace, a tent: any space you&apos;ll decorate. You&apos;ll add photos in the studio.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="space-name">Name</Label>
        <Input
          id="space-name"
          autoFocus
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Grand Ballroom"
          aria-invalid={invalid}
          aria-describedby={invalid ? "space-name-error" : undefined}
        />
        {invalid && (
          <p id="space-name-error" className="text-sm text-destructive">
            Give the room a name.
          </p>
        )}
      </div>
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md py-1 pointer-coarse:min-h-11 text-left text-sm font-medium">
          <span>
            Describe the room <span className="font-normal text-muted-foreground">(optional)</span>
          </span>
          <ChevronDownIcon className="size-4 text-muted-foreground transition-transform duration-200 group-data-panel-open:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4">
          <p className="mb-4 text-sm text-muted-foreground">
            Helps the engine keep the room accurate, and lets you generate a starting image if you have no photos.
          </p>
          <VenueSpecFields value={spec} onChange={setSpec} idPrefix="space-spec" />
        </CollapsibleContent>
      </Collapsible>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
        <Button type="submit" disabled={create.isPending}>
          Add room
        </Button>
      </DialogFooter>
    </form>
  );
}
