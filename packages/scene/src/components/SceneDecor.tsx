import type { DesignSpec, Layout, TablePlacement } from "../types";
import { BanquetTable } from "./BanquetTable";
import { Centerpiece } from "./Centerpiece";
import { ChiavariChair } from "./ChiavariChair";
import { DanceFloor } from "./DanceFloor";
import { FlamelessCandle } from "./FlamelessCandle";
import { RoundTable } from "./RoundTable";
import { StringLights } from "./StringLights";
import { Uplight } from "./Uplight";

function DressedTable({ table, spec, index }: { table: TablePlacement; spec: DesignSpec; index: number }) {
  const height = table.shape === "cocktail" ? 3.6 : 2.6;
  return (
    <group>
      {"diameterFt" in table
        ? <RoundTable table={table} linens={spec.linens} />
        : <BanquetTable table={table} linens={spec.linens} />}
      {table.chairs.map((chair, i) => <ChiavariChair key={i} chair={chair} decor={spec.chairs} />)}
      <group position={[table.x, 0, table.z]}>
        <Centerpiece decor={spec.centerpieces} palette={spec.palette} index={index} tableHeight={height} />
        {spec.centerpieces.candles && spec.centerpieces.candles !== "none" && [-0.8, 0.8].map(x => (
          <FlamelessCandle key={x} position={[x, height + 0.03, 0]} />
        ))}
        {spec.lighting.pin_spots && (
          <pointLight position={[0, height + 3, 0]} color="#fff1d8" intensity={8} distance={6} />
        )}
      </group>
    </group>
  );
}

export function SceneDecor({ spec, layout }: { spec: DesignSpec; layout: Layout }) {
  return (
    <group>
      {layout.tables.map((table, i) => <DressedTable key={i} table={table} spec={spec} index={i} />)}
      {layout.headTable && <DressedTable table={layout.headTable} spec={spec} index={0} />}
      {layout.danceFloor && <DanceFloor floor={layout.danceFloor} />}
      {spec.lighting.uplighting && <Uplight room={layout.room} text={spec.lighting.uplighting} />}
      {spec.lighting.string_lights && <StringLights room={layout.room} />}
    </group>
  );
}
