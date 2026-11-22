"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VenueSpecFields } from "@/components/venue-spec-fields";
import { api, errorMessage } from "@/lib/api";
import { qk } from "@/lib/queries";
import { defaultRules } from "@/lib/spec";
import type { VenueSpec } from "@/lib/types";

/** No photos yet: describe the empty room, then the studio generates a photoreal starting image to approve. */
export function DescribeIt() {
  const router = useRouter();
  const qc = useQueryClient();
  const [venueName, setVenueName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [spec, setSpec] = useState<VenueSpec>({ fixtures: [] });
  const [submitted, setSubmitted] = useState(false);
  const errors = {
    venue: !venueName.trim() ? "Give the venue a name." : null,
    room: !roomName.trim() ? "Name the room." : null,
  };

  const save = useMutation({
    mutationFn: async () => {
      const venue = await api.createVenue({ name: venueName.trim(), rules: defaultRules() });
      return api.createSpace(venue.id, { name: roomName.trim(), venue_spec: spec });
    },
    onSuccess: (space) => {
      void qc.invalidateQueries({ queryKey: qk.venues });
      qc.setQueryData(qk.space(space.id), space);
      router.push(`/spaces/${space.id}`);
    },
    onError: (e) => toast.error("Couldn't add the venue", { description: errorMessage(e) }),
  });

  return (
    <form
      className="grid max-w-3xl gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (!errors.venue && !errors.room) save.mutate();
      }}
    >
      <p className="text-sm text-pretty text-muted-foreground">
        Describe the empty room and we&apos;ll generate a photoreal starting image for you to approve. Swap in real photos whenever you have them.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {(
          [
            ["describe-venue", "Venue name", venueName, setVenueName, "e.g. Hollow Creek Farm", errors.venue],
            ["describe-room", "Room name", roomName, setRoomName, "e.g. The Hayloft", errors.room],
          ] as const
        ).map(([id, label, value, set, placeholder, error]) => (
          <div key={id} className="grid gap-2">
            <Label htmlFor={id}>{label}</Label>
            <Input
              id={id}
              value={value}
              onChange={(e) => set(e.target.value)}
              placeholder={placeholder}
              autoComplete="off"
              aria-invalid={submitted && Boolean(error)}
              aria-describedby={submitted && error ? `${id}-error` : undefined}
            />
            {submitted && error && (
              <p id={`${id}-error`} className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        ))}
      </div>
      <VenueSpecFields value={spec} onChange={setSpec} idPrefix="describe-spec" />
      <div className="border-t pt-6">
        <Button type="submit" size="lg" disabled={save.isPending}>
          {save.isPending ? "Creating…" : "Continue to the studio"}
        </Button>
      </div>
    </form>
  );
}
