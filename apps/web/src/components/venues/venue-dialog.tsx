"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { RulesFields } from "@/components/venues/rules-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { qk } from "@/lib/queries";
import { defaultRules } from "@/lib/spec";
import type { Venue, VenueRules } from "@/lib/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this venue; omit to create a new one. */
  venue?: Venue;
};

export function VenueDialog({ open, onOpenChange, venue }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        {/* Remounting the form on open resets it without effects. */}
        {open && <VenueForm venue={venue} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function VenueForm({ venue, onDone }: { venue?: Venue; onDone: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState(venue?.name ?? "");
  const [rules, setRules] = useState<VenueRules>(venue?.rules ?? defaultRules());
  const [touched, setTouched] = useState(false);
  const nameError = touched && !name.trim() ? "Give the venue a name." : null;

  const save = useMutation({
    mutationFn: () => (venue ? api.updateVenue(venue.id, { name: name.trim(), rules }) : api.createVenue({ name: name.trim(), rules })),
    onSuccess: (saved) => {
      qc.setQueryData(qk.venue(saved.id), saved);
      void qc.invalidateQueries({ queryKey: qk.venues });
      toast.success(venue ? "Venue saved" : "Venue created", { description: saved.name });
      onDone();
      if (!venue) router.push(`/venues/${saved.id}`);
    },
    onError: (e) => toast.error(venue ? "Couldn't save the venue" : "Couldn't create the venue", { description: errorMessage(e) }),
  });

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (name.trim()) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle className="font-display text-3xl font-normal">{venue ? "Edit venue" : "New venue"}</DialogTitle>
        <DialogDescription>
          {venue ? "Changes to the rules apply to every plan from now on." : "Name it and set the house rules. You can add rooms next."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="venue-name">Name</Label>
        <Input
          id="venue-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="e.g. Larkspur House"
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? "venue-name-error" : undefined}
          autoComplete="off"
        />
        {nameError && (
          <p id="venue-name-error" className="text-sm text-destructive">
            {nameError}
          </p>
        )}
      </div>
      <RulesFields value={rules} onChange={setRules} idPrefix="venue-rule" />
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
        <Button type="submit" disabled={save.isPending}>
          {venue ? "Save venue" : "Create venue"}
        </Button>
      </DialogFooter>
    </form>
  );
}
