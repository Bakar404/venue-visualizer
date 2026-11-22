"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { PCFSoftShadowMap } from "three";
import { colorFor } from "./colors";
import { layoutTables } from "./layout";
import { Room } from "./components/Room";
import { SceneCamera } from "./components/SceneCamera";
import { SceneDecor } from "./components/SceneDecor";
import type { DesignSpec, Layout, SceneCamera as CameraAngle, SceneMode, VenueSceneProps } from "./types";

declare global {
  interface Window {
    __VV_SCENE_READY?: boolean;
    /** Set when the scene can't be a faithful layout guide (e.g. tables overflow the room). */
    __VV_SCENE_ERROR?: string;
  }
}

const AMBIENTS = {
  daylight: { color: "#f3f7ff", ground: "#b4a99a", intensity: 2.4, sun: 3, background: "#e8edf0" },
  evening_warm: { color: "#ffe6c2", ground: "#a38970", intensity: 1.5, sun: 2, background: "#e3d8c9" },
  dim: { color: "#bdc5df", ground: "#6d6060", intensity: 0.5, sun: 0.6, background: "#45454f" },
  colored: { color: "#d5c0dd", ground: "#796d8b", intensity: 0.9, sun: 1, background: "#817985" },
};

function Lighting({ spec, room }: { spec: DesignSpec; room: Layout["room"] }) {
  const preset = AMBIENTS[spec.lighting?.ambient ?? "evening_warm"] ?? AMBIENTS.evening_warm;
  const span = Math.max(room.widthFt, room.lengthFt);
  return (
    <>
      <color attach="background" args={[preset.background]} />
      <hemisphereLight args={[spec.lighting.ambient === "colored" ? colorFor(spec.lighting.uplighting ?? spec.palette[0] ?? "blush") : preset.color, preset.ground, preset.intensity]} />
      <directionalLight
        position={[room.widthFt * 0.3, Math.max(room.ceilingFt * 2, span), room.lengthFt * 0.2]}
        color={preset.color}
        intensity={preset.sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-camera-far={span * 5}
        shadow-normalBias={0.04}
      />
    </>
  );
}

function ReadyFrame({ mode, onReady, layout, angle }: {
  mode: SceneMode; onReady?: () => void; layout: Layout; angle: CameraAngle;
}) {
  const { gl, scene, camera, size } = useThree();
  const callback = useRef(onReady);
  callback.current = onReady;
  useLayoutEffect(() => {
    window.__VV_SCENE_READY = false;
    // A guide with tables outside the room would mislead the image model: report it instead of "ready".
    if (layout.overflow) window.__VV_SCENE_ERROR = layout.warnings.join(" ");
    else delete window.__VV_SCENE_ERROR;
    return () => { window.__VV_SCENE_READY = false; };
  }, [layout, mode, angle, size.width, size.height]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      // Signal only after a completed draw, not merely after Canvas mounts.
      gl.render(scene, camera);
      if (mode === "still" && !layout.overflow) window.__VV_SCENE_READY = true;
      callback.current?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [gl, scene, camera, mode, layout, angle, size.width, size.height]);
  return null;
}

export function VenueScene({ spec, venueSpec, mode = "orbit", camera = "wide", onReady }: VenueSceneProps) {
  const layout = useMemo(() => layoutTables(spec, venueSpec), [spec, venueSpec]);
  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <Canvas
        key={mode}
        aria-label={`Stylized 3D scene of ${spec.space}, ${spec.tables.count} guest tables`}
        shadows={{ type: PCFSoftShadowMap }}
        frameloop={mode === "still" ? "never" : "always"}
        gl={{ preserveDrawingBuffer: mode === "still", antialias: true }}
        dpr={mode === "still" ? 1 : [1, 2]}
        fallback={<div role="alert">WebGL is required to display this venue scene.</div>}
      >
        <Lighting spec={spec} room={layout.room} />
        <Room room={layout.room} venue={venueSpec} />
        <SceneDecor spec={spec} layout={layout} />
        <SceneCamera layout={layout} mode={mode} angle={camera} />
        <ReadyFrame mode={mode} onReady={onReady} layout={layout} angle={camera} />
      </Canvas>
      {mode === "walk" && (
        <div style={{ position: "absolute", bottom: 12, left: 12, pointerEvents: "none", color: "#faf8f2", background: "#252526", padding: "8px 12px" }}>
          Click the scene to walk. WASD to move; Esc to release.
        </div>
      )}
      {layout.warnings.length > 0 && (
        <div role="status" style={{ position: "absolute", top: 12, left: 12, right: 12, color: "#252526", background: "#f3edda", padding: "8px 12px", pointerEvents: "none" }}>
          {layout.warnings.join(" ")}
        </div>
      )}
    </div>
  );
}
