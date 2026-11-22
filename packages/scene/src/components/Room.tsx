import { colorFor } from "../colors";
import type { Layout, VenueSpec } from "../types";

export function Room({ room, venue }: { room: Layout["room"]; venue?: VenueSpec }) {
  const { widthFt: width, lengthFt: length, ceilingFt: height } = room;
  const wallColor = colorFor(venue?.walls ?? "ivory");
  const walls: { position: [number, number, number]; rotation: [number, number, number]; width: number }[] = [
    { position: [0, height / 2, -length / 2], rotation: [0, 0, 0], width },
    { position: [0, height / 2, length / 2], rotation: [0, Math.PI, 0], width },
    { position: [-width / 2, height / 2, 0], rotation: [0, Math.PI / 2, 0], width: length },
    { position: [width / 2, height / 2, 0], rotation: [0, -Math.PI / 2, 0], width: length },
  ];
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color={colorFor(venue?.floor ?? "wood")} roughness={0.88} />
      </mesh>
      {/* Inward-facing surfaces create a cutaway from outside, including the top view. */}
      {walls.map((wall, i) => (
        <group key={i} position={wall.position} rotation={wall.rotation}>
          <mesh receiveShadow>
            <planeGeometry args={[wall.width, height]} />
            <meshStandardMaterial color={wallColor} roughness={0.95} />
          </mesh>
          {venue?.windows && i !== 1 && Array.from({ length: Math.max(1, Math.floor(wall.width / 12)) }, (_, j) => {
            const count = Math.max(1, Math.floor(wall.width / 12));
            return (
              <mesh key={j} position={[(j + 0.5) * wall.width / count - wall.width / 2, height * 0.08, 0.02]}>
                <planeGeometry args={[Math.min(4, wall.width * 0.6), height * 0.5]} />
                <meshStandardMaterial color="#e4edf0" emissive="#d6e5e9" emissiveIntensity={0.12} />
              </mesh>
            );
          })}
        </group>
      ))}
      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color="#f2efe8" roughness={1} />
      </mesh>
    </group>
  );
}
