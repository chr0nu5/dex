import React, { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import PokemonModel from "./PokemonModel";

interface Pokemon3DModelProps {
  pokemonNumber: number; // e.g., 1 for Bulbasaur, 25 for Pikachu
  width?: number;
  height?: number;
  autoRotate?: boolean;
  enableControls?: boolean;
  backgroundColor?: string | null; // null for transparent
  scale?: number;
}

const Pokemon3DModel: React.FC<Pokemon3DModelProps> = ({
  pokemonNumber,
  width = 300,
  height = 300,
  autoRotate = false,
  enableControls = true,
  backgroundColor = null,
  scale = 1,
}) => {
  return (
    <div style={{ width, height, display: "inline-block" }}>
      <Canvas
        camera={{ position: [0, 1, 3], fov: 50 }}
        gl={{ antialias: true, alpha: !backgroundColor }}
        style={{ background: backgroundColor || "transparent" }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 10, 5]} intensity={0.8} />
        <pointLight position={[-10, -10, -5]} intensity={0.4} />
        <Suspense fallback={null}>
          <PokemonModel
            pokemonNumber={pokemonNumber}
            autoRotate={autoRotate}
            scale={scale}
          />
        </Suspense>
        {enableControls && (
          <OrbitControls
            enablePan={false}
            enableZoom={true}
            autoRotate={autoRotate}
            autoRotateSpeed={2.0}
            dampingFactor={0.05}
            enableDamping={true}
          />
        )}
      </Canvas>
    </div>
  );
};

export default Pokemon3DModel;

