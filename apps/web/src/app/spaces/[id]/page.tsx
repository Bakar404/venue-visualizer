import type { Metadata } from "next";
import { Suspense } from "react";

import { Studio } from "@/components/studio/studio";

export const metadata: Metadata = { title: "Studio" };

export default function StudioPage({ params }: PageProps<"/spaces/[id]">) {
  return (
    <Suspense>
      <Studio params={params} />
    </Suspense>
  );
}
