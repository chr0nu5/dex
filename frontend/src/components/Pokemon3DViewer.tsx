import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

type TextureMap = Record<string, string>;

type Render3DConfig = {
  pokemonId: number;
  pm: string;
  rigFolder: string;
  baseUrl: string;
  fbx: string;
  textureMap: TextureMap;
};

type Props = {
  pokemonId: number;
  width: number;
  height: number;
  showError?: boolean;
  className?: string;
  style?: React.CSSProperties;
};

const clampPokemonId = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.floor(value);
};

const resolveTextureFile = (
  matName: string,
  textureMap: TextureMap
): string | null => {
  if (!matName) return textureMap.Body_SHINY ?? null;

  // Exact match first
  const direct = textureMap[matName];
  if (direct) return direct;

  // Case-insensitive match (some exporters vary casing)
  const lower = matName.toLowerCase();
  for (const [k, v] of Object.entries(textureMap)) {
    if (k.toLowerCase() === lower) return v;
  }

  // Heuristic fallback: eyes vs body
  if (lower.includes("eye")) {
    return textureMap.Eye ?? textureMap.Eye1 ?? textureMap.Eye_MATERIAL ?? null;
  }

  return textureMap.Body_SHINY ?? null;
};

const Pokemon3DViewer: React.FC<Props> = ({
  pokemonId,
  width,
  height,
  showError = false,
  className,
  style,
}) => {
  const clampedId = useMemo(() => clampPokemonId(pokemonId), [pokemonId]);

  const mountRef = useRef<HTMLDivElement | null>(null);
  const [config, setConfig] = useState<Render3DConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setError(null);
      setConfig(null);
      try {
        const res = await fetch(`/api/render/3d/${clampedId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Render3DConfig;
        if (cancelled) return;
        setConfig(data);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || String(e));
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [clampedId]);

  useEffect(() => {
    if (!config) return;
    const mount = mountRef.current;
    if (!mount) return;

    // Clear previous renderer if any
    mount.innerHTML = "";

    // ===== BEGIN: code mirrors the provided index.html =====
    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1.0;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enableZoom = false;
    controls.minPolarAngle = Math.PI / 2;
    controls.maxPolarAngle = Math.PI / 2;

    // Ambiente reflexivo para brilho
    const cubeLoader = new THREE.CubeTextureLoader();
    const envMap = cubeLoader.load([
      "https://threejs.org/examples/textures/cube/skybox/px.jpg",
      "https://threejs.org/examples/textures/cube/skybox/nx.jpg",
      "https://threejs.org/examples/textures/cube/skybox/py.jpg",
      "https://threejs.org/examples/textures/cube/skybox/ny.jpg",
      "https://threejs.org/examples/textures/cube/skybox/pz.jpg",
      "https://threejs.org/examples/textures/cube/skybox/nz.jpg",
    ]);
    envMap.encoding = THREE.sRGBEncoding;
    scene.environment = envMap;

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambient);

    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
    scene.add(hemisphere);

    const directional = new THREE.DirectionalLight(0xffffff, 0.5);
    directional.position.set(300, 500, 300);
    scene.add(directional);

    const loader = new FBXLoader();
    const textureLoader = new THREE.TextureLoader();

    const textureMap: TextureMap = config.textureMap;

    let model: any;

    const onLoaded = (object: any) => {
      object.traverse((child: any) => {
        if (child.isMesh) {
          const materials: any[] = Array.isArray(child.material)
            ? child.material
            : [child.material];

          materials.forEach((material, index) => {
            const matName = material?.name || child.name;
            const textureFile = resolveTextureFile(
              String(matName || ""),
              textureMap
            );

            const applyMaterial = (nextMaterial: any) => {
              if (Array.isArray(child.material)) {
                const next = [...child.material];
                next[index] = nextMaterial;
                child.material = next;
              } else {
                child.material = nextMaterial;
              }
            };

            if (textureFile) {
              textureLoader.load(
                `${config.baseUrl}${textureFile}`,
                (texture) => {
                  texture.encoding = THREE.sRGBEncoding;
                  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
                  texture.generateMipmaps = true;
                  texture.minFilter = THREE.LinearMipmapLinearFilter;
                  texture.magFilter = THREE.LinearFilter;
                  texture.needsUpdate = true;

                  applyMaterial(
                    new THREE.MeshStandardMaterial({
                      map: texture,
                      envMap: envMap,
                      metalness: 0.5,
                      roughness: 0.5,
                      toneMapped: false,
                    })
                  );
                }
              );
            } else {
              applyMaterial(
                new THREE.MeshStandardMaterial({
                  color: new THREE.Color(
                    Math.random(),
                    Math.random(),
                    Math.random()
                  ),
                  metalness: 0.3,
                  roughness: 0.1,
                  envMap: envMap,
                })
              );
            }
          });
        }
      });

      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      object.position.set(-center.x, -box.min.y, -center.z);

      const maxDim = Math.max(size.x, size.y, size.z);
      const distance = maxDim * 2;
      camera.position.set(0, size.y * 0.6, distance);
      controls.target.set(0, size.y * 0.5, 0);
      controls.update();

      model = object;
      scene.add(object);
    };

    loader.load(`${config.baseUrl}${config.fbx}`, onLoaded);

    let raf = 0;
    function animate() {
      raf = requestAnimationFrame(animate);
      controls.update();
      if (model) {
        model.rotation.y -= 0.003;
      }
      renderer.render(scene, camera);
    }

    animate();

    // ===== END: code mirrors the provided index.html =====

    return () => {
      cancelAnimationFrame(raf);
      controls.dispose();
      renderer.dispose();
      mount.innerHTML = "";
    };
  }, [config, width, height]);

  return (
    <div className={className} style={style}>
      {showError && error ? (
        <div style={{ color: "#b00020" }}>Error: {error}</div>
      ) : null}
      <div
        ref={mountRef}
        style={{
          width,
          height,
          background: "transparent",
          overflow: "hidden",
        }}
      />
    </div>
  );
};

export default Pokemon3DViewer;
