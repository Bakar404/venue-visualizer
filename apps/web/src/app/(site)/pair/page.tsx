import type { Metadata } from "next";

import { PairForm } from "@/components/pair-form";

export const metadata: Metadata = { title: "Pair this phone" };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-md px-4 pt-12 pb-24 sm:px-6 sm:pt-20">
      <h1 className="font-display text-5xl leading-none">Pair this phone</h1>
      <p className="mt-4 mb-8 text-pretty text-muted-foreground">
        For safety, the computer only talks to phones that know its one-time code. Type the 6 digits it shows.
      </p>
      <PairForm />
    </div>
  );
}
