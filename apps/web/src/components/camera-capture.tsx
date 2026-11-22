"use client";

import { CameraIcon, VideoIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  /** "photos": several stills from the back camera. "video": one walkthrough recording. */
  kind: "photos" | "video";
  onFiles: (files: FileList | null) => void;
  disabled?: boolean;
  className?: string;
  variant?: "outline" | "default" | "secondary";
  size?: "default" | "sm";
};

/**
 * Opens the phone's camera straight away. Shown only on touch devices, next to the normal file picker (which on a
 * phone offers the photo library). The input sits inside its label, so it's only focusable when the label is shown.
 */
export function CameraCapture({ kind, onFiles, disabled, className, variant = "outline", size = "default" }: Props) {
  const photos = kind === "photos";
  return (
    <label
      className={cn(
        buttonVariants({ variant, size }),
        "hidden cursor-pointer has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50 pointer-coarse:inline-flex",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <input
        type="file"
        accept={photos ? "image/*" : "video/*"}
        capture="environment"
        multiple={photos || undefined}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {photos ? <CameraIcon aria-hidden /> : <VideoIcon aria-hidden />}
      {photos ? "Take photos" : "Record a walkthrough"}
    </label>
  );
}
