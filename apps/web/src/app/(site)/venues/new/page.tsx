import type { Metadata } from "next";
import { Suspense } from "react";

import { NewVenue } from "@/components/new-venue/new-venue";

export const metadata: Metadata = { title: "New venue" };

export default function NewVenuePage() {
  return (
    <Suspense>
      <NewVenue />
    </Suspense>
  );
}
