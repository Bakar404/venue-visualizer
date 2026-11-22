import { colorFor } from "../colors";
import type { ChairPlacement, DesignSpec } from "../types";
import { Box, Cylinder } from "./primitives";

export function ChiavariChair({ chair, decor }: { chair: ChairPlacement; decor: DesignSpec["chairs"] }) {
  const color = colorFor(decor.color);
  return (
    <group position={[chair.x, 0, chair.z]} rotation={[0, chair.rotY, 0]}>
      <Box size={[1.35, 0.16, 1.35]} position={[0, 1.55, 0]} color={color} />
      <Box size={[1.2, 0.15, 1.2]} position={[0, 1.7, 0]} color={colorFor(decor.cushion ?? "ivory")} />
      {[-0.57, 0.57].flatMap(x => [-0.57, 0.57].map(z => (
        <Cylinder key={`${x}:${z}`} args={[0.065, 0.08, z < 0 ? 3.15 : 1.5, 6]} position={[x, z < 0 ? 1.575 : 0.75, z]} color={color} />
      )))}
      {[2.15, 2.6, 3.05].map(y => (
        <Box key={y} size={[1.25, 0.09, 0.09]} position={[0, y, -0.57]} color={color} />
      ))}
      {[-0.3, 0, 0.3].map(x => (
        <Cylinder key={x} args={[0.035, 0.035, 1.35, 6]} position={[x, 2.4, -0.57]} color={color} />
      ))}
    </group>
  );
}
