import Link from "next/link";

import { BackendList } from "@/components/backend-status";
import { CompareSlider } from "@/components/compare-slider";
import { DitherBackground } from "@/components/dither-background";
import { Spotlight, SpotlightCard } from "@/components/spotlight";
import { buttonVariants } from "@/components/ui/button";
import { SAMPLE_CREDITS_URL, SAMPLE_PAIRS, SAMPLES } from "@/lib/samples";
import { cn } from "@/lib/utils";

const steps = [
  {
    title: "Add your venue",
    body: "Find it by name and we'll gather its photos and published rules, or upload your own photos or a walk-through video. Confirm the house rules once: no open flames, no confetti, whatever applies.",
  },
  {
    title: "Describe the look",
    body: "Write it the way you'd tell a planner. The plan updates as you talk, and anything the venue won't allow is swapped for something it will.",
  },
  {
    title: "Compare and export",
    body: "Every photo is edited, not redrawn, so results look like real photographs of your room. Save each idea as a Look, compare two, and export a PDF for your florist or planner.",
  },
];

export default function Home() {
  return (
    <>
      <section className="relative isolate overflow-hidden border-b">
        <DitherBackground />
        <Spotlight />
        <div className="relative mx-auto grid w-full max-w-[1400px] gap-12 px-4 pt-16 pb-20 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center lg:gap-16 lg:pt-24 lg:pb-28">
          <div>
            <h1 className="font-display text-[3.4rem] leading-[0.95] tracking-[-0.02em] text-balance sm:text-7xl xl:text-[6.2rem]">
              See your event before it happens
            </h1>
            <p className="mt-7 max-w-[34rem] text-lg leading-relaxed text-pretty text-muted-foreground">
              Photograph the room, describe the decor in plain words, and see tables, flowers and light
              placed into your own venue. It runs on your computer with the AI tools you already have.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/venues/new" className={cn(buttonVariants({ size: "lg" }), "h-11 px-5 text-[0.95rem]")}>
                Start a venue
              </Link>
              <Link href="/venues" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-11 px-4 text-[0.95rem]")}>
                Open your venues
              </Link>
            </div>
          </div>
          <figure className="relative">
            <div className="rounded-[1.25rem] bg-card/70 p-2 shadow-[0_1px_0_0_var(--border),0_30px_60px_-30px_oklch(0.3_0.03_60/0.35)] ring-1 ring-border backdrop-blur-sm">
              <CompareSlider
                before={SAMPLES["ballroom-a"].empty}
                after={SAMPLES["ballroom-a"].looks.blush!.url}
                beforeAlt={SAMPLES["ballroom-a"].alt}
                afterAlt={SAMPLES["ballroom-a"].looks.blush!.alt}
                className="aspect-[3/2] rounded-[0.85rem]"
                initial={42}
                optimize={{ sizes: "(min-width: 1400px) 760px, (min-width: 1024px) 55vw, calc(100vw - 2rem)", preload: true }}
              />
            </div>
            <figcaption className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-2 text-sm text-muted-foreground">
              <span>Drag the divider. The walls, windows and chandeliers stay; only the decor is added.</span>
              <DemoCredit />
            </figcaption>
          </figure>
        </div>
      </section>

      <section aria-labelledby="looks" className="border-b bg-muted/30">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-16 sm:px-6 lg:py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="looks" className="font-display text-4xl sm:text-5xl">
                Same room, different Looks
              </h2>
              <p className="mt-3 max-w-xl text-pretty text-muted-foreground">
                Each Look starts again from the original photo, so the room never drifts. Drag to compare.
              </p>
            </div>
            <DemoCredit />
          </div>
          <ul className="mt-10 grid gap-6 md:grid-cols-3">
            {SAMPLE_PAIRS.map((pair) => (
              <li key={pair.id}>
                <figure>
                  <CompareSlider
                    before={pair.before}
                    after={pair.after}
                    beforeAlt={pair.beforeAlt}
                    afterAlt={pair.afterAlt}
                    afterLabel={pair.title}
                    className="aspect-[3/2] rounded-xl ring-1 ring-border"
                    initial={50}
                    optimize={{ sizes: "(min-width: 1400px) 450px, (min-width: 768px) 32vw, calc(100vw - 2rem)" }}
                  />
                  <figcaption className="mt-3 text-sm">
                    <span className="font-medium">{pair.title}.</span> <span className="text-muted-foreground">{pair.caption}</span>
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="how" className="mx-auto w-full max-w-[1400px] px-4 py-20 sm:px-6 lg:py-28">
        <h2 id="how" className="font-display text-4xl sm:text-5xl">
          Three steps, one afternoon
        </h2>
        <ol className="mt-12 grid gap-4 md:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title}>
              <SpotlightCard className="h-full p-6 sm:p-8">
                <span aria-hidden className="font-display text-6xl leading-none text-brand">
                  {i + 1}
                </span>
                <h3 className="mt-6 text-lg font-medium">{step.title}</h3>
                <p className="mt-2 leading-relaxed text-pretty text-muted-foreground">{step.body}</p>
              </SpotlightCard>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="byo" className="border-t bg-muted/40">
        <div className="mx-auto grid w-full max-w-[1400px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:py-28">
          <div>
            <h2 id="byo" className="font-display text-4xl sm:text-5xl">
              Bring your own AI
            </h2>
            <p className="mt-5 max-w-md leading-relaxed text-pretty text-muted-foreground">
              Venue Visualizer has no account and no subscription. It uses the coding agents and photo
              engines already signed in on this machine, and every result is an edit of a real photograph.
              This list is live from your local API.
            </p>
          </div>
          <BackendList />
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-[1400px] flex-col items-start gap-6 px-4 py-20 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:py-24">
        <p className="font-display max-w-2xl text-4xl leading-tight text-balance sm:text-5xl">
          Your photos and plans stay on your machine.
        </p>
        <Link href="/venues/new" className={cn(buttonVariants({ size: "lg" }), "h-11 px-5 text-[0.95rem]")}>
          Start a venue
        </Link>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <span>Venue Visualizer is open source.</span>
          <span>Press ⌘K anywhere to search or run a command.</span>
        </div>
      </footer>
    </>
  );
}

function DemoCredit({ className }: { className?: string }) {
  return (
    <a
      href={SAMPLE_CREDITS_URL}
      className={cn("text-xs text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground", className)}
    >
      AI-generated demo images
    </a>
  );
}
