import { useMemo } from "react";
import { Object3D } from "three";
import { colorFor } from "../colors";
import type { Layout } from "../types";
import { Box } from "./primitives";

function Fixture({ x, z, height, color }: { x: number; z: number; height: number; color: string }) {
  const target = useMemo(() => {
    const object = new Object3D();
    object.position.set(x, height * 0.8, z);
    return object;
  }, [x, z, height]);
  return (
    <>
      <primitive object={target} />
      <spotLight position={[x, 0.25, z]} target={target} color={color} intensity={45} angle={0.5} penumbra={0.8} distance={height * 2} decay={1} />
      <Box size={[0.45, 0.25, 0.45]} position={[x, 0.125, z]} color="#353337" />
    </>
  );
}

export function Uplight({ room, text }: { room: Layout["room"]; text: string }) {
  const color = colorFor(text);
  return (
    <group>
      {[-1, 1].flatMap(side => [-0.3, 0, 0.3].map(part => (
        <Fixture key={`${side}:${part}`} x={side * (room.widthFt / 2 - 0.4)} z={room.lengthFt * part} height={room.ceilingFt} color={color} />
      )))}
    </group>
  );
}
