import { Cylinder } from "./primitives";

export function FlamelessCandle({ position = [0, 2.65, 0] }: { position?: [number, number, number] }) {
  return (
    <group position={position}>
      <Cylinder args={[0.12, 0.12, 0.55, 12]} position={[0, 0.275, 0]} color="#f1e5cb" />
      <Cylinder args={[0.045, 0.065, 0.09, 8]} position={[0, 0.58, 0]} color="#ffc979" emissive="#ffb94c" />
    </group>
  );
}
