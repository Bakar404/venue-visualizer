"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, ImagePlusIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RulesFields } from "@/components/venues/rules-fields";
import { api, errorMessage } from "@/lib/api";
import { qk } from "@/lib/queries";
import { defaultRules } from "@/lib/spec";
import type { VenueRules } from "@/lib/types";
import { cn } from "@/lib/utils";

const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PER_SPACE = 30;

type Staged = { file: File; url: string };
type DraftSpace = { key: string; name: string; files: Staged[] };

function accepted(file: File) {
  return ACCEPT.includes(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
}

let seq = 0;
const newSpace = (name = ""): DraftSpace => ({ key: `s${++seq}`, name, files: [] });

/** Venue name, house rules and one or more rooms with photos staged locally; everything is created on submit. */
export function UploadVenue() {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [rules, setRules] = useState<VenueRules>(defaultRules);
  const [spaces, setSpaces] = useState<DraftSpace[]>(() => [newSpace()]);
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState("");

  const errors = {
    name: !name.trim() ? "Give the venue a name." : null,
    spaces: spaces.some((s) => !s.name.trim()) ? "Name every room." : null,
  };

  const patch = (key: string, next: Partial<DraftSpace>) => setSpaces((all) => all.map((s) => (s.key === key ? { ...s, ...next } : s)));
  const remove = (key: string) =>
    setSpaces((all) => {
      all.find((s) => s.key === key)?.files.forEach((f) => URL.revokeObjectURL(f.url));
      return all.filter((s) => s.key !== key);
    });

  const save = useMutation({
    mutationFn: async () => {
      setStatus("Creating the venue…");
      const venue = await api.createVenue({ name: name.trim(), rules });
      for (const [i, s] of spaces.entries()) {
        setStatus(`Adding ${s.name.trim()} (${i + 1} of ${spaces.length})…`);
        const space = await api.createSpace(venue.id, { name: s.name.trim(), venue_spec: { fixtures: [] } });
        if (s.files.length) await api.uploadPhotos(space.id, s.files.map((f) => f.file));
      }
      return venue;
    },
    onSuccess: (venue) => {
      spaces.forEach((s) => s.files.forEach((f) => URL.revokeObjectURL(f.url)));
      void qc.invalidateQueries({ queryKey: qk.venues });
      toast.success("Venue added", { description: venue.name });
      router.push(`/venues/${venue.id}`);
    },
    onError: (e) => {
      setStatus("");
      toast.error("Couldn't add the venue", { description: errorMessage(e) });
    },
  });

  return (
    <form
      className="grid max-w-3xl gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (!errors.name && !errors.spaces) save.mutate();
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="upload-name">Venue name</Label>
        <Input
          id="upload-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. The Larkspur House"
          autoComplete="off"
          aria-invalid={submitted && Boolean(errors.name)}
          aria-describedby={submitted && errors.name ? "upload-name-error" : undefined}
        />
        {submitted && errors.name && (
          <p id="upload-name-error" className="text-sm text-destructive">
            {errors.name}
          </p>
        )}
      </div>

      <section aria-labelledby="upload-rooms" className="grid gap-4">
        <div>
          <h2 id="upload-rooms" className="text-lg font-medium">
            Rooms and photos
          </h2>
          <p className="text-sm text-muted-foreground">
            Photos of the empty room work best: wide, level, taken from where guests will stand. You can add more later.
          </p>
        </div>
        {spaces.map((s, i) => (
          <SpaceDraft
            key={s.key}
            space={s}
            index={i}
            removable={spaces.length > 1}
            invalid={submitted && !s.name.trim()}
            onChange={(next) => patch(s.key, next)}
            onRemove={() => remove(s.key)}
          />
        ))}
        <Button type="button" variant="outline" className="w-fit" onClick={() => setSpaces((all) => [...all, newSpace()])}>
          <PlusIcon aria-hidden /> Add another room
        </Button>
      </section>

      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md py-1 text-left text-lg font-medium">
          <span>
            House rules <span className="text-sm font-normal text-muted-foreground">(optional, editable later)</span>
          </span>
          <ChevronDownIcon aria-hidden className="size-4 text-muted-foreground transition-transform duration-200 ease-out group-data-panel-open:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4">
          <RulesFields value={rules} onChange={setRules} idPrefix="upload-rule" />
        </CollapsibleContent>
      </Collapsible>

      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button type="submit" size="lg" disabled={save.isPending}>
          {save.isPending ? "Adding…" : "Add venue"}
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {save.isPending ? status : null}
        </p>
      </div>
    </form>
  );
}

function SpaceDraft({
  space,
  index,
  removable,
  invalid,
  onChange,
  onRemove,
}: {
  space: DraftSpace;
  index: number;
  removable: boolean;
  invalid: boolean;
  onChange: (next: Partial<DraftSpace>) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const add = (list: FileList | null) => {
    if (!list) return;
    const files = [...list];
    const wrong = files.filter((f) => !accepted(f)).length;
    const big = files.filter((f) => accepted(f) && f.size > MAX_BYTES).length;
    let ok = files.filter((f) => accepted(f) && f.size <= MAX_BYTES);
    if (wrong) toast.error(`Skipped ${wrong} file${wrong > 1 ? "s" : ""}`, { description: "Use JPG, PNG, WebP or HEIC photos." });
    if (big) toast.error(`Skipped ${big} large file${big > 1 ? "s" : ""}`, { description: "Each photo can be up to 20 MB." });
    const room = MAX_PER_SPACE - space.files.length;
    if (ok.length > room) {
      toast.error(`Up to ${MAX_PER_SPACE} photos per room`);
      ok = ok.slice(0, Math.max(0, room));
    }
    if (ok.length) onChange({ files: [...space.files, ...ok.map((file) => ({ file, url: URL.createObjectURL(file) }))] });
  };

  return (
    <fieldset className="rounded-2xl border bg-card p-4 sm:p-5">
      <legend className="sr-only">Room {index + 1}</legend>
      <div className="flex items-end gap-3">
        <div className="grid flex-1 gap-2">
          <Label htmlFor={`${id}-name`}>Room name</Label>
          <Input
            id={`${id}-name`}
            value={space.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={index === 0 ? "e.g. Grand Ballroom" : "e.g. Garden Terrace"}
            autoComplete="off"
            aria-invalid={invalid}
            aria-describedby={invalid ? `${id}-error` : undefined}
          />
        </div>
        {removable && (
          <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${space.name || `room ${index + 1}`}`}>
            <Trash2Icon aria-hidden />
          </Button>
        )}
      </div>
      {invalid && (
        <p id={`${id}-error`} className="mt-2 text-sm text-destructive">
          Name this room.
        </p>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
        className={cn(
          "mt-4 rounded-xl border border-dashed p-4 transition-colors duration-150",
          over ? "border-brand bg-brand-soft" : "border-border",
        )}
      >
        {space.files.length > 0 && (
          <ul className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Photos to upload">
            {space.files.map((f) => (
              <li key={f.url} className="group relative">
                <img src={f.url} alt={f.file.name} className="aspect-[3/2] w-full rounded-md bg-muted object-cover" />
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(f.url);
                    onChange({ files: space.files.filter((x) => x.url !== f.url) });
                  }}
                  className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/60 text-white transition-transform duration-150 ease-out active:scale-[0.94]"
                  aria-label={`Remove ${f.file.name}`}
                >
                  <XIcon aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
            <ImagePlusIcon aria-hidden /> {space.files.length ? "Add more photos" : "Choose photos"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {space.files.length ? `${space.files.length} photo${space.files.length === 1 ? "" : "s"} ready. ` : "Or drop them here. "}
            JPG, PNG, WebP or HEIC, up to 20 MB each.
          </p>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT.join(",") + ",.heic,.heif"}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </fieldset>
  );
}
