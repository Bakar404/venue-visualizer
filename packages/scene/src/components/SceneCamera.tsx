import { useEffect, useLayoutEffect, useRef } from "react";
import { OrbitControls, PointerLockControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, Vector3 } from "three";
import { layoutBounds } from "../layout";
import type { Layout, SceneCamera as CameraAngle, SceneMode } from "../types";

function Walk({ room }: { room: Layout["room"] }) {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const forward = useRef(new Vector3());
  const right = useRef(new Vector3());
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (document.pointerLockElement === gl.domElement && ["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
        event.preventDefault();
        keys.current.add(event.code);
      }
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.code);
    const clear = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("pointerlockchange", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("pointerlockchange", clear);
    };
  }, [gl]);
  useFrame((_, delta) => {
    if (document.pointerLockElement !== gl.domElement) return;
    camera.getWorldDirection(forward.current);
    forward.current.y = 0;
    forward.current.normalize();
    right.current.crossVectors(forward.current, camera.up).normalize();
    const longitudinal = Number(keys.current.has("KeyW")) - Number(keys.current.has("KeyS"));
    const lateral = Number(keys.current.has("KeyD")) - Number(keys.current.has("KeyA"));
    const speed = 7 * Math.min(delta, 0.1) / Math.max(1, Math.hypot(longitudinal, lateral));
    camera.position.addScaledVector(forward.current, longitudinal * speed);
    camera.position.addScaledVector(right.current, lateral * speed);
    camera.position.x = Math.max(-room.widthFt / 2 + 1, Math.min(room.widthFt / 2 - 1, camera.position.x));
    camera.position.z = Math.max(-room.lengthFt / 2 + 1, Math.min(room.lengthFt / 2 - 1, camera.position.z));
  });
  return <PointerLockControls />;
}

/** Frames the room plus every placed table, chair, dance floor and head table (overflow included). */
export function SceneCamera({ layout, mode, angle }: { layout: Layout; mode: SceneMode; angle: CameraAngle }) {
  const { camera, size } = useThree();
  const { room } = layout;
  const bounds = layoutBounds(layout);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    camera.up.set(0, 1, 0);
    camera.fov = 48;
    const aspect = size.width / Math.max(1, size.height);
    const distance = Math.max(spanZ, spanX / aspect) * 1.3;
    camera.far = Math.max(2000, distance * 10);
    if (mode === "walk") {
      camera.position.set(0, Math.min(5.5, room.ceilingFt - 0.5), room.lengthFt / 2 - 3);
      camera.lookAt(0, camera.position.y, 0);
    } else if (angle === "top") {
      camera.position.set(cx, distance, cz);
      camera.up.set(0, 0, -1);
      camera.lookAt(cx, 0, cz);
    } else {
      camera.position.set(
        cx + distance * (angle === "corner" ? 0.65 : 0.28),
        distance * 0.7 + room.ceilingFt * 0.25,
        cz + distance * (angle === "corner" ? 0.65 : 0.9),
      );
      camera.lookAt(cx, 1.5, cz);
    }
    camera.updateProjectionMatrix();
  }, [camera, room, cx, cz, spanX, spanZ, mode, angle, size.width, size.height]);
  if (mode === "walk") return <Walk room={room} />;
  if (mode === "orbit") {
    return <OrbitControls makeDefault target={[cx, 1.5, cz]} maxPolarAngle={Math.PI / 2 - 0.04} minDistance={5} maxDistance={Math.max(spanX, spanZ) * 4} />;
  }
  return null;
}
