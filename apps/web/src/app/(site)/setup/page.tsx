import type { Metadata } from "next";

import { SetupPage } from "@/components/setup/setup-page";

export const metadata: Metadata = { title: "Set up your AI tools" };

export default function Page() {
  return <SetupPage />;
}
