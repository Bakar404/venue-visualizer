import { colorFor } from "../colors";
import type { DesignSpec, RoundPlacement } from "../types";
import { Cylinder } from "./primitives";

export function RoundTable({ table, linens }: { table: RoundPlacement; linens: DesignSpec["linens"] }) {
  const radius = table.diameterFt / 2;
  const height = table.shape === "cocktail" ? 3.5 : 2.5;
  const linen = linens.length ?? "floor";
  const drop = linen === "floor" ? height - 0.08 : 1;
  return (
    <group position={[table.x, 0, table.z]}>
      <Cylinder args={[0.18, 0.3, height, 8]} position={[0, height / 2, 0]} color="#695b4e" />
      <Cylinder args={[radius, radius, 0.16, 32]} position={[0, height, 0]} color="#947454" />
      {linen !== "none" && (
        <Cylinder
          args={[radius + 0.04, radius + 0.18, drop, 32]}
          position={[0, height + 0.1 - drop / 2, 0]}
          color={colorFor(linens.color)}
        />
      )}
      {linens.runner && (
        <Cylinder args={[radius * 0.45, radius * 0.45, 0.025, 24]} position={[0, height + 0.12, 0]} color={colorFor(linens.runner)} />
      )}
    </group>
  );
}
