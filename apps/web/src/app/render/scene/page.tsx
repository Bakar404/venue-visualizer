"use client";

import dynamic from "next/dynamic";

// WebGL only exists in the browser, so the scene is never prerendered.
const SceneRoute = dynamic(() => import("@/components/render/scene-route").then((m) => m.SceneRoute), { ssr: false });

/**
 * Layout guide for the backend's scene3d engine (contract: packages/scene/README.md).
 * Full viewport, exactly one canvas, no chrome; sets `window.__VV_SCENE_READY` after the first completed draw.
 */
export default function RenderScenePage() {
  return <SceneRoute />;
}
