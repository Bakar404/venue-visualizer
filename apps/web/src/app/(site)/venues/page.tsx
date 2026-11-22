import type { Metadata } from "next";
import { Suspense } from "react";

import { VenuesIndex } from "@/components/venues/venues-index";

export const metadata: Metadata = { title: "Venues" };

export default function VenuesPage() {
  return (
    <Suspense>
      <VenuesIndex />
    </Suspense>
  );
}
