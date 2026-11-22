import type { FloorPlacement } from "../types";
import { Box } from "./primitives";

export function DanceFloor({ floor }: { floor: FloorPlacement }) {
  const columns = Math.ceil(floor.widthFt / 2);
  const rows = Math.ceil(floor.lengthFt / 2);
  const width = floor.widthFt / columns;
  const length = floor.lengthFt / rows;
  return (
    <group position={[floor.x, 0.04, floor.z]}>
      {Array.from({ length: rows * columns }, (_, i) => {
        const col = i % columns;
        const row = Math.floor(i / columns);
        return (
          <Box key={i} size={[width, 0.06, length]} position={[(col + 0.5) * width - floor.widthFt / 2, 0, (row + 0.5) * length - floor.lengthFt / 2]} color={(col + row) % 2 ? "#a0805e" : "#c6ab86"} />
        );
      })}
    </group>
  );
}
