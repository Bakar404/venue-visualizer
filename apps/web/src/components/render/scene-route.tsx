"use client";

import { VenueScene } from "@vv/scene";
import { Component, useEffect, useState, type ReactNode } from "react";

import { decodeSceneParams, type SceneParams } from "@/lib/scene-params";

declare global {
  interface Window {
    __VV_SCENE_READY?: boolean;
    /** Set when the query can't be decoded or validated, so the backend fails fast instead of timing out. */
    __VV_SCENE_ERROR?: string;
  }
}

function reportSceneError(message: string) {
  window.__VV_SCENE_READY = false;
  window.__VV_SCENE_ERROR = message;
}

/** Any render error inside the 3D scene becomes `__VV_SCENE_ERROR`, so the backend fails fast. */
class SceneErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    reportSceneError(error instanceof Error ? error.message : String(error));
  }

  render() {
    if (this.state.error !== null) {
      return (
        <p role="alert" style={{ font: "14px/1.4 system-ui, sans-serif", padding: 16, margin: 0 }}>
          The layout guide couldn&apos;t be drawn: {this.state.error}
        </p>
      );
    }
    return this.props.children;
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
    if (!parsed.ok) reportSceneError(parsed.error);
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
      <SceneErrorBoundary>
        <VenueScene spec={spec} venueSpec={venue} mode="still" camera={camera} />
      </SceneErrorBoundary>
    </div>
  );
}
