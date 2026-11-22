import type { Metadata } from "next";

// Internal routes used by the local backend (headless Chromium). Never linked, never indexed.
export const metadata: Metadata = {
  title: "Layout guide",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function RenderLayout({ children }: { children: React.ReactNode }) {
  return children;
}
