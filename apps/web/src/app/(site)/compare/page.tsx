import type { Metadata } from "next";
import { Suspense } from "react";

import { CompareLooks } from "@/components/looks/compare-looks";

export const metadata: Metadata = { title: "Compare Looks" };

export default function ComparePage() {
  return (
    <Suspense>
      <CompareLooks />
    </Suspense>
  );
}
