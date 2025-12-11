import React, { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import PokemonModel from "./PokemonModel";

interface Pokemon3DProps {
  number: number; // Pokemon dex number (1-904)
  width?: number;
  height?: number;
  autoRotate?: boolean;
  transparent?: boolean;
}

const Pokemon3D: React.FC<Pokemon3DProps> = ({
  number,
  width = 200,
  height = 200,
  autoRotate = false,
  transparent = false,
}) => {
  return (
    <div style={{ width, height }}>
      <Canvas
        camera={{ position: [0, 1, 3], fov: 50 }}
        gl={{ antialias: true, alpha: transparent }}
        style={{ background: transparent ? "transparent" : "#2c3e50" }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 10, 5]} intensity={0.8} />
        <Suspense fallback={null}>
          <PokemonModel pokemonNumber={number} autoRotate={autoRotate} />
        </Suspense>
        <OrbitControls enablePan={false} enableZoom={true} autoRotate={autoRotate} />
      </Canvas>
    </div>
  );
};

export default Pokemon3D;

