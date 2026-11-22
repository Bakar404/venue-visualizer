import type { Layout } from "../types";
import { Cylinder } from "./primitives";

export function StringLights({ room }: { room: Layout["room"] }) {
  const bulbs = Math.max(2, Math.ceil(room.widthFt / 3));
  const height = room.ceilingFt - 0.7;
  return (
    <group>
      {[-0.3, 0, 0.3].map(row => (
        <group key={row} position={[0, height, row * room.lengthFt]}>
          <Cylinder args={[0.025, 0.025, room.widthFt, 6]} rotation={[0, 0, Math.PI / 2]} color="#655950" />
          {Array.from({ length: bulbs }, (_, i) => (
            <Cylinder key={i} args={[0.09, 0.12, 0.2, 8]} position={[(i + 0.5) * room.widthFt / bulbs - room.widthFt / 2, -0.15, 0]} color="#ffe5a4" emissive="#ffcf77" />
          ))}
          <pointLight position={[0, -0.5, 0]} color="#ffda9a" intensity={30} distance={room.widthFt} decay={1} />
        </group>
      ))}
    </group>
  );
}
