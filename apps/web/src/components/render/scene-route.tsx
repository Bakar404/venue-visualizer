"use client";

import { VenueScene } from "@vv/scene";
import { useEffect, useState } from "react";

import { decodeSceneParams, type SceneParams } from "@/lib/scene-params";

declare global {
  interface Window {
    __VV_SCENE_READY?: boolean;
    /** Set when the query can't be decoded or validated, so the backend fails fast instead of timing out. */
    __VV_SCENE_ERROR?: string;
  }
}

type Parsed = { ok: true; value: SceneParams } | { ok: false; error: string };

function read(): Parsed {
  try {
    const value = decodeSceneParams(new URLSearchParams(window.location.search));
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function SceneRoute() {
  // Rendered with `ssr: false`, so reading the URL during the first render is safe.
  const [parsed] = useState(read);

  useEffect(() => {
    if (!parsed.ok) {
      window.__VV_SCENE_READY = false;
      window.__VV_SCENE_ERROR = parsed.error;
    }
  }, [parsed]);

  if (!parsed.ok) {
    return (
      <p role="alert" style={{ font: "14px/1.4 system-ui, sans-serif", padding: 16, margin: 0 }}>
        Invalid layout guide request: {parsed.error}
      </p>
    );
  }

  const { spec, venue, camera } = parsed.value;
  return (
    <div style={{ position: "fixed", inset: 0, margin: 0 }}>
      <VenueScene spec={spec} venueSpec={venue} mode="still" camera={camera} />
    </div>
  );
}
