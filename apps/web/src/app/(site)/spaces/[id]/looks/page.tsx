import type { Metadata } from "next";
import { Suspense } from "react";

import { LooksGallery } from "@/components/looks/looks-gallery";

export const metadata: Metadata = { title: "Looks" };

export default function LooksPage({ params }: PageProps<"/spaces/[id]/looks">) {
  return (
    <Suspense>
      <LooksGallery params={params} />
    </Suspense>
  );
}
