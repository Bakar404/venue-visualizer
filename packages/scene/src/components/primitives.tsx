import type { ThreeElements } from "@react-three/fiber";

type Position = [number, number, number];
interface SolidProps {
  position?: Position;
  rotation?: Position;
  color: string;
  emissive?: string;
}

export function Box({ size, position, rotation, color }: SolidProps & { size: Position }) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.8} />
    </mesh>
  );
}

export function Cylinder({
  args, position, rotation, color, emissive,
}: SolidProps & { args: ThreeElements["cylinderGeometry"]["args"] }) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <cylinderGeometry args={args} />
      <meshStandardMaterial color={color} roughness={0.85} emissive={emissive} emissiveIntensity={emissive ? 1.5 : 0} />
    </mesh>
  );
}

export function Bloom({ position, color, scale = [1, 1, 1] }: {
  position: Position; color: string; scale?: Position;
}) {
  return (
    <mesh position={position} scale={scale} castShadow>
      <icosahedronGeometry args={[0.32, 0]} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  );
}
