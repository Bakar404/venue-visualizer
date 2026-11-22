import { colorFor } from "../colors";
import type { DesignSpec, RectangularPlacement } from "../types";
import { Box, Cylinder } from "./primitives";

export function BanquetTable({ table, linens }: { table: RectangularPlacement; linens: DesignSpec["linens"] }) {
  const linen = linens.length ?? "floor";
  const drop = linen === "floor" ? 2.42 : 1;
  const color = colorFor(linens.color);
  return (
    <group position={[table.x, 0, table.z]}>
      {[-1, 1].flatMap(x => [-1, 1].map(z => (
        <Box key={`${x}:${z}`} size={[0.18, 2.5, 0.18]} position={[x * table.widthFt * 0.35, 1.25, z * table.lengthFt * 0.35]} color="#695b4e" />
      )))}
      {table.shape === "oval" ? (
        <group scale={[table.widthFt / 2, 1, table.lengthFt / 2]}>
          <Cylinder args={[1, 1, 0.16, 32]} position={[0, 2.5, 0]} color="#947454" />
          {linen !== "none" && (
            <Cylinder args={[1.02, 1.08, drop, 32]} position={[0, 2.6 - drop / 2, 0]} color={color} />
          )}
        </group>
      ) : (
        <>
          <Box size={[table.widthFt, 0.16, table.lengthFt]} position={[0, 2.5, 0]} color="#947454" />
          {linen !== "none" && (
            <Box size={[table.widthFt + 0.12, drop, table.lengthFt + 0.12]} position={[0, 2.6 - drop / 2, 0]} color={color} />
          )}
        </>
      )}
      {linens.runner && (
        <Box size={[table.widthFt * 0.35, 0.025, table.lengthFt]} position={[0, 2.62, 0]} color={colorFor(linens.runner)} />
      )}
    </group>
  );
}
