import { Suspense } from "react";

import { VenueDetail } from "@/components/venues/venue-detail";

export default function VenuePage({ params }: PageProps<"/venues/[id]">) {
  return (
    <Suspense>
      <VenueDetail params={params} />
    </Suspense>
  );
}
