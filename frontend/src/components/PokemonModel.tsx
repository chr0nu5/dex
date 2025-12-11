import React, { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";
import * as THREE from "three";

interface PokemonModelProps {
  pokemonNumber: number;
  autoRotate?: boolean;
  scale?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
}

const PokemonModel: React.FC<PokemonModelProps> = ({
  pokemonNumber,
  autoRotate = false,
  scale = 1,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const [model, setModel] = useState<THREE.Group | null>(null);

  // Format pokemon number to pm0001 format
  const pmId = `pm${String(pokemonNumber).padStart(4, "0")}`;
  const modelPath = `/3d/${pmId}/${pmId}_00_Rig/${pmId}_00_Rig.fbx`;

  useEffect(() => {
    const loader = new FBXLoader();

    loader.load(
      modelPath,
      (fbx) => {
        // Texture loading with fallback patterns
        const textureLoader = new THREE.TextureLoader();
        const texturePaths = [
          `${pmId}_00_BodyAll1.png`,
          `${pmId}_00_Body_Col.png`,
          `${pmId}_00_BodyA_Col.png`,
          `${pmId}_00_BodyAll_Col.png`,
          `${pmId}_00_Body1.png`,
          `${pmId}_00_BodyA1.png`,
          `${pmId}_00_BodyB1.png`,
          `${pmId}_00_BodyAll.png`,
          `${pmId}_00_BodyAll_col.png`,
          `${pmId}_00_BodyAll_col_rare.png`,
          `${pmId}_00_BodyAll_Col_rare.png`,
          `${pmId}_00_Body_col.png`,
          `${pmId}_00_BodyA_col_rare.png`,
        ];

        const applyTextureToMesh = (texture: THREE.Texture) => {
          fbx.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              if (Array.isArray(mesh.material)) {
                mesh.material.forEach((mat) => {
                  if (mat && (mat as THREE.MeshStandardMaterial).map !== undefined) {
                    (mat as THREE.MeshStandardMaterial).map = texture;
                    mat.needsUpdate = true;
                  }
                });
              } else if (mesh.material) {
                (mesh.material as THREE.MeshStandardMaterial).map = texture;
                mesh.material.needsUpdate = true;
              }
            }
          });
        };

        const tryLoadTexture = (index: number) => {
          if (index >= texturePaths.length) return;

          const path = `/3d/${pmId}/${pmId}_00_Rig/${texturePaths[index]}`;
          textureLoader.load(
            path,
            (texture) => {
              applyTextureToMesh(texture);
            },
            undefined,
            () => {
              tryLoadTexture(index + 1);
            }
          );
        };

        // Apply default gray materials first
        fbx.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            if (Array.isArray(mesh.material)) {
              mesh.material = mesh.material.map((mat) => {
                const originalMat = mat as THREE.MeshStandardMaterial;
                const newMat = new THREE.MeshStandardMaterial({
                  color: 0xcccccc,
                });
                newMat.name = originalMat.name;
                return newMat;
              });
            } else if (mesh.material) {
              mesh.material = new THREE.MeshStandardMaterial({
                color: 0xcccccc,
              });
            }
          }
        });

        tryLoadTexture(0);

        // Center model
        const box = new THREE.Box3().setFromObject(fbx);
        const center = box.getCenter(new THREE.Vector3());
        fbx.position.sub(center);

        setModel(fbx);
      },
      undefined,
      (error) => {
        console.warn(`Error loading 3D model for Pokemon #${pokemonNumber}:`, error);
      }
    );
  }, [pokemonNumber, modelPath, pmId]);

  useFrame(() => {
    if (autoRotate && groupRef.current) {
      groupRef.current.rotation.y += 0.01;
    }
  });

  if (!model) return null;

  return (
    <group ref={groupRef} scale={scale} position={position} rotation={new THREE.Euler(...rotation)}>
      <primitive object={model} />
    </group>
  );
};

export default PokemonModel;
