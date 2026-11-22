"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function SaveLookDialog({
  open,
  onOpenChange,
  suggestedName,
  onSave,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestedName: string;
  onSave: (name: string) => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open && <SaveForm suggestedName={suggestedName} onSave={onSave} pending={pending} />}</DialogContent>
    </Dialog>
  );
}

function SaveForm({ suggestedName, onSave, pending }: { suggestedName: string; onSave: (name: string) => void; pending: boolean }) {
  const [name, setName] = useState(suggestedName);
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(name.trim() || suggestedName);
      }}
    >
      <DialogHeader>
        <DialogTitle className="font-display text-3xl font-normal">Save as Look</DialogTitle>
        <DialogDescription>Saves the current plan so you can render it, compare it and export it later.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="look-name">Name</Label>
        <Input id="look-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
        <Button type="submit" disabled={pending}>
          Save Look
        </Button>
      </DialogFooter>
    </form>
  );
}

const IDEAS = ["Swap to sage and ivory", "Long banquet tables instead of rounds", "Low centerpieces with more candles", "Moodier, dimmer lighting"];

export function VariationDialog({
  open,
  onOpenChange,
  baseName,
  onSubmit,
  pending,
  willRender,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseName: string;
  onSubmit: (prompt: string) => void;
  pending: boolean;
  willRender: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <VariationForm baseName={baseName} onSubmit={onSubmit} pending={pending} willRender={willRender} />}
      </DialogContent>
    </Dialog>
  );
}

function VariationForm({ baseName, onSubmit, pending, willRender }: { baseName: string; onSubmit: (prompt: string) => void; pending: boolean; willRender: boolean }) {
  const [prompt, setPrompt] = useState("");
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (prompt.trim()) onSubmit(prompt.trim());
      }}
    >
      <DialogHeader>
        <DialogTitle className="font-display text-3xl font-normal">Make a variation</DialogTitle>
        <DialogDescription>
          Starts from {baseName} and changes only what you describe. {baseName} stays as it is
          {willRender ? ", and the variation renders on every photo." : "."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="variation-prompt">What should change?</Label>
        <Textarea
          id="variation-prompt"
          autoFocus
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (prompt.trim()) onSubmit(prompt.trim());
            }
          }}
          placeholder="Same layout, but in deep green and gold"
        />
        <div className="flex flex-wrap gap-1.5">
          {IDEAS.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => setPrompt(idea)}
              className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
            >
              {idea}
            </button>
          ))}
        </div>
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
        <Button type="submit" disabled={pending || !prompt.trim()}>
          {pending ? "Working…" : "Make variation"}
        </Button>
      </DialogFooter>
    </form>
  );
}
