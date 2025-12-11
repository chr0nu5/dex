import React, { useState, useEffect, Suspense, lazy } from "react";

const Pokemon3D = lazy(() => import("./Pokemon3D"));

interface PokemonImageProps {
  number: number; // Dex number
  staticSrc: string;
  animatedSrc?: string;
  width?: number;
  height?: number;
  enable3D?: boolean;
}

const PokemonImage: React.FC<PokemonImageProps> = ({
  number,
  staticSrc,
  animatedSrc,
  width = 96,
  height = 96,
  enable3D = true,
}) => {
  const [mode, setMode] = useState<"3d" | "animated" | "static">("3d");
  const [animLoaded, setAnimLoaded] = useState(false);

  // Check if 3D exists
  useEffect(() => {
    if (!enable3D) {
      setMode(animatedSrc ? "animated" : "static");
      return;
    }

    const pmId = `pm${String(number).padStart(4, "0")}`;
    fetch(`/3d/${pmId}/${pmId}_00_Rig/${pmId}_00_Rig.fbx`, { method: "HEAD" })
      .then((res) => {
        if (!res.ok) setMode(animatedSrc ? "animated" : "static");
      })
      .catch(() => setMode(animatedSrc ? "animated" : "static"));
  }, [number, animatedSrc, enable3D]);

  // Preload animated
  useEffect(() => {
    if (!animatedSrc) return;
    const img = new Image();
    img.onload = () => setAnimLoaded(true);
    img.src = animatedSrc;
  }, [animatedSrc]);

  const style: React.CSSProperties = {
    width,
    height,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  // 3D
  if (mode === "3d" && enable3D) {
    return (
      <div style={style}>
        <Suspense
          fallback={
            <img
              src={staticSrc}
              alt={`#${number}`}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                imageRendering: "pixelated",
              }}
            />
          }
        >
          <Pokemon3D
            number={number}
            width={width}
            height={height}
            transparent
            autoRotate={false}
          />
        </Suspense>
      </div>
    );
  }

  // Animated
  if (mode === "animated" && animLoaded && animatedSrc) {
    return (
      <div style={style}>
        <img
          src={animatedSrc}
          alt={`#${number}`}
          onError={() => setMode("static")}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            imageRendering: "pixelated",
          }}
        />
      </div>
    );
  }

  // Static
  return (
    <div style={style}>
      <img
        src={staticSrc}
        alt={`#${number}`}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          imageRendering: "pixelated",
        }}
      />
    </div>
  );
};

export default PokemonImage;
