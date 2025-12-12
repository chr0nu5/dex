import React, { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "antd";
import { HomeOutlined } from "@ant-design/icons";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import html2canvas from "html2canvas";

const TILE_WIDTH = 392;
const TILE_HEIGHT = 900;
const TILE_GAP = 25;

const defaultCorners = {
  tl: { x: 0.09, y: 0.01 },
  tr: { x: -0.02, y: 0.02 },
  bl: { x: 0.085, y: -0.011 },
  br: { x: -0.02, y: -0.03 },
};

interface DistortedPlaneProps {
  image: string;
  corners: typeof defaultCorners;
}

const DistortedPlane: React.FC<DistortedPlaneProps> = ({ image, corners }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [texture] = useState(() => new THREE.TextureLoader().load(image));

  useEffect(() => {
    if (!meshRef.current) return;

    const geometry = new THREE.PlaneGeometry(1, 1, 100, 100);
    const pos = geometry.attributes.position;

    const relToAbs = (pt: { x: number; y: number }) => ({
      x: pt.x * TILE_WIDTH,
      y: pt.y * TILE_HEIGHT,
    });

    const tl = relToAbs(corners.tl);
    const tr = relToAbs(corners.tr);
    const bl = relToAbs(corners.bl);
    const br = relToAbs(corners.br);

    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) + 0.5;
      const v = 1 - (pos.getY(i) + 0.5);

      const dx =
        (1 - u) * (1 - v) * tl.x +
        u * (1 - v) * tr.x +
        (1 - u) * v * bl.x +
        u * v * br.x;

      const dy =
        (1 - u) * (1 - v) * tl.y +
        u * (1 - v) * tr.y +
        (1 - u) * v * bl.y +
        u * v * br.y;

      const px = pos.getX(i) + dx / TILE_WIDTH;
      const py = pos.getY(i) - dy / TILE_HEIGHT;

      pos.setXYZ(i, px, py, 0);
    }

    pos.needsUpdate = true;
    meshRef.current.geometry = geometry;
  }, [corners]);

  return (
    <mesh ref={meshRef} scale={[TILE_WIDTH, TILE_HEIGHT, 1]}>
      <planeGeometry args={[1, 1, 100, 100]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  );
};

interface SceneProps {
  image: string;
}

const Scene: React.FC<SceneProps> = ({ image }) => {
  return (
    <Canvas
      orthographic
      camera={{ zoom: 1, position: [0, 0, 5] }}
      gl={{ preserveDrawingBuffer: true }}
    >
      <DistortedPlane image={image} corners={defaultCorners} />
    </Canvas>
  );
};

const GeneratorPage: React.FC = () => {
  const navigate = useNavigate();
  const [images, setImages] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const roundCorners = (
    imageSrc: string,
    radius: number = 140
  ): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(imageSrc);
          return;
        }
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.lineTo(canvas.width - radius, 0);
        ctx.quadraticCurveTo(canvas.width, 0, canvas.width, radius);
        ctx.lineTo(canvas.width, canvas.height - radius);
        ctx.quadraticCurveTo(
          canvas.width,
          canvas.height,
          canvas.width - radius,
          canvas.height
        );
        ctx.lineTo(radius, canvas.height);
        ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - radius);
        ctx.lineTo(0, radius);
        ctx.quadraticCurveTo(0, 0, radius, 0);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL());
      };
      img.onerror = () => {
        console.error("Error loading image");
        resolve(imageSrc);
      };
      img.src = imageSrc;
    });
  };

  const exportImage = () => {
    if (!wrapperRef.current) return;

    html2canvas(wrapperRef.current, {
      backgroundColor: null,
      useCORS: true,
      allowTaint: true,
    } as any).then((canvas) => {
      const link = document.createElement("a");
      link.download = "pokemon-3d-output.png";
      link.href = canvas.toDataURL("image/png");
      link.click();

      // Reset for new drop
      setTimeout(() => {
        setImages([]);
      }, 500);
    });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!e.dataTransfer.files?.length) return;

    const files = Array.from(e.dataTransfer.files);
    const readers = files.map(
      (file) =>
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = async (event) => {
            const original = event.target?.result as string;
            const rounded = await roundCorners(original, 140);
            resolve(rounded);
          };
          reader.readAsDataURL(file);
        })
    );

    Promise.all(readers).then((results) => {
      setImages(results);
      setTimeout(() => {
        exportImage();
      }, 2000);
    });
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  // Choose cols/rows that make the final exported image as close to square as possible,
  // accounting for the tall iPhone tile aspect ratio.
  const getGridLayout = (count: number) => {
    if (count === 0) return { cols: 0, rows: 0 };

    const maxCols = Math.min(count, 12);
    let best = { cols: 1, rows: count, score: Number.POSITIVE_INFINITY };

    for (let cols = 1; cols <= maxCols; cols++) {
      const rows = Math.ceil(count / cols);
      const width = cols * TILE_WIDTH + Math.max(0, cols - 1) * TILE_GAP;
      const height = rows * TILE_HEIGHT + Math.max(0, rows - 1) * TILE_GAP;

      const squareDiff = Math.abs(width - height) / Math.max(width, height);
      const empty = cols * rows - count;

      // Prioritize squareness; lightly penalize wasted slots.
      const score = squareDiff + empty * 0.02;

      if (
        score < best.score ||
        (score === best.score && empty < best.cols * best.rows - count)
      ) {
        best = { cols, rows, score };
      }
    }

    return { cols: best.cols, rows: best.rows };
  };

  const { cols, rows } = getGridLayout(images.length);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px",
        overflow: "auto",
      }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <Button
        icon={<HomeOutlined />}
        onClick={() => navigate("/")}
        style={{
          position: "fixed",
          top: 16,
          left: 16,
          background: "linear-gradient(145deg, #2d2d44, #3a3a54)",
          border: "1px solid #4a4a6a",
          color: "#e0e0e0",
          height: "48px",
          borderRadius: "12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "48px",
          zIndex: 50,
          transition: "all 0.2s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "#5555ff";
          e.currentTarget.style.boxShadow = "0 4px 12px rgba(85, 85, 255, 0.3)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "#4a4a6a";
          e.currentTarget.style.boxShadow = "none";
        }}
      />

      {images.length === 0 ? (
        <div
          style={{
            padding: "80px",
            border: `3px dashed ${isDragOver ? "#5555ff" : "#3a3a54"}`,
            borderRadius: "20px",
            background: isDragOver
              ? "linear-gradient(145deg, #25253a, #2d2d44)"
              : "linear-gradient(145deg, #1e1e2e, #25253a)",
            textAlign: "center",
            transition: "all 0.3s ease",
            boxShadow: isDragOver
              ? "0 10px 30px rgba(85, 85, 255, 0.3)"
              : "0 8px 24px rgba(0, 0, 0, 0.5)",
          }}
        >
          <div
            style={{
              fontSize: "24px",
              fontWeight: "600",
              color: "#ffffff",
              marginBottom: "10px",
            }}
          >
            {isDragOver ? "Drop screenshots here!" : "Drop Pokemon Screenshots"}
          </div>
          <div style={{ fontSize: "16px", color: "#b0b0c0" }}>
            Images will be processed in 3D and downloaded automatically
          </div>
        </div>
      ) : (
        <div
          ref={wrapperRef}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, ${TILE_WIDTH}px)`,
            gridTemplateRows: `repeat(${rows}, ${TILE_HEIGHT}px)`,
            gap: `${TILE_GAP}px`,
            justifyItems: "center",
            alignItems: "center",
          }}
        >
          {images.map((src, index) => {
            // Calculate if this item should be centered (last row with fewer items)
            const isLastRow = Math.floor(index / cols) === rows - 1;
            const itemsInLastRow = images.length % cols || cols;
            const shouldCenter = isLastRow && itemsInLastRow < cols;
            const positionInLastRow = index % cols;

            return (
              <div
                key={index}
                style={{
                  width: `${TILE_WIDTH}px`,
                  height: `${TILE_HEIGHT}px`,
                  position: "relative",
                  overflow: "hidden",
                  perspective: "1600px",
                  gridColumn: shouldCenter
                    ? `${
                        Math.floor((cols - itemsInLastRow) / 2) +
                        positionInLastRow +
                        1
                      }`
                    : "auto",
                }}
              >
                <div
                  style={{
                    width: `${TILE_WIDTH}px`,
                    height: `${TILE_HEIGHT}px`,
                  }}
                >
                  <Scene image={src} />
                </div>
                <img
                  src="/img/iphone2.png"
                  alt="frame"
                  style={{
                    position: "absolute",
                    width: `${TILE_WIDTH}px`,
                    height: `${TILE_HEIGHT}px`,
                    top: 0,
                    left: 0,
                    pointerEvents: "none",
                    zIndex: 10,
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default GeneratorPage;
