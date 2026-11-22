import { colorFor } from "../colors";
import type { DesignSpec } from "../types";
import { Bloom, Cylinder } from "./primitives";

export function Centerpiece({ decor, palette, index = 0, tableHeight = 2.6 }: {
  decor: DesignSpec["centerpieces"]; palette: string[]; index?: number; tableHeight?: number;
}) {
  if (decor.height === "none") return null;
  const tall = decor.height === "tall" || (decor.height === "mixed" && index % 2 === 1);
  const height = tall ? 2.7 : decor.height === "medium" ? 1.1 : 0.55;
  const colors = decor.colors?.length ? decor.colors : palette.length ? palette : ["ivory", "blush"];
  return (
    <group position={[0, tableHeight, 0]}>
      <Cylinder args={[0.38, 0.23, 0.3, 12]} position={[0, 0.15, 0]} color={colorFor(decor.container ?? "gold")} />
      {tall && (
        <Cylinder args={[0.055, 0.075, height, 8]} position={[0, height / 2, 0]} color={colorFor(decor.container ?? "gold")} />
      )}
      {Array.from({ length: 9 }, (_, i) => {
        const angle = i * Math.PI * 2 / 8;
        return (
          <Bloom key={i} position={[i === 8 ? 0 : Math.cos(angle) * 0.48, height + (i === 8 ? 0.3 : (i % 2) * 0.12), i === 8 ? 0 : Math.sin(angle) * 0.48]} color={colorFor(colors[i % colors.length])} />
        );
      })}
      {Array.from({ length: 6 }, (_, i) => {
        const angle = i * Math.PI / 3;
        return <Bloom key={i} position={[Math.cos(angle) * 0.6, height - 0.1, Math.sin(angle) * 0.6]} color={colorFor("greenery")} scale={[1.3, 0.3, 0.65]} />;
      })}
    </group>
  );
}
