import React, { useState, useEffect, lazy, Suspense } from "react";

const Pokemon3DModel = lazy(() => import("./Pokemon3DModel"));

interface PokemonCardImageProps {
  pokemonNumber: number; // Dex number (e.g., 1, 25, 150)
  staticSrc: string; // Path to static icon
  animatedSrc?: string; // Path to animated GIF (optional)
  width?: number;
  height?: number;
  use3D?: boolean; // Force 3D on/off
  className?: string;
}

const PokemonCardImage: React.FC<PokemonCardImageProps> = ({
  pokemonNumber,
  staticSrc,
  animatedSrc,
  width = 96,
  height = 96,
  use3D = true,
  className = "",
}) => {
  const [imageType, setImageType] = useState<"3d" | "animated" | "static">(
    "3d"
  );
  const [animatedLoaded, setAnimatedLoaded] = useState(false);
  const [model3DFailed, setModel3DFailed] = useState(false);

  // Check if 3D model exists
  useEffect(() => {
    if (!use3D) {
      setImageType(animatedSrc ? "animated" : "static");
      return;
    }

    const checkModel = async () => {
      const pmNumber = `pm${String(pokemonNumber).padStart(4, "0")}`;
      const modelPath = `/3d/${pmNumber}/${pmNumber}_00_Rig/${pmNumber}_00_Rig.fbx`;

      try {
        const response = await fetch(modelPath, { method: "HEAD" });
        if (!response.ok) {
          setModel3DFailed(true);
          setImageType(animatedSrc ? "animated" : "static");
        }
      } catch {
        setModel3DFailed(true);
        setImageType(animatedSrc ? "animated" : "static");
      }
    };

    checkModel();
  }, [pokemonNumber, animatedSrc, use3D]);

  // Preload animated image
  useEffect(() => {
    if (!animatedSrc) return;

    const img = new Image();
    img.onload = () => setAnimatedLoaded(true);
    img.onerror = () => setAnimatedLoaded(false);
    img.src = animatedSrc;
  }, [animatedSrc]);

  const handleImageError = () => {
    if (imageType === "animated") {
      setImageType("static");
    }
  };

  const containerStyle: React.CSSProperties = {
    width: `${width}px`,
    height: `${height}px`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  };

  // Render 3D model
  if (imageType === "3d" && !model3DFailed && use3D) {
    return (
      <div style={containerStyle} className={className}>
        <Suspense
          fallback={
            <img
              src={staticSrc}
              alt={`Pokemon ${pokemonNumber}`}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                imageRendering: "pixelated",
              }}
            />
          }
        >
          <Pokemon3DModel
            pokemonNumber={pokemonNumber}
            width={width}
            height={height}
            autoRotate={false}
            enableControls={true}
            backgroundColor={null}
            scale={1}
          />
        </Suspense>
      </div>
    );
  }

  // Render animated GIF
  if (imageType === "animated" && animatedLoaded && animatedSrc) {
    return (
      <div style={containerStyle} className={className}>
        <img
          src={animatedSrc}
          alt={`Pokemon ${pokemonNumber}`}
          onError={handleImageError}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            imageRendering: "pixelated",
          }}
        />
      </div>
    );
  }

  // Render static icon (fallback)
  return (
    <div style={containerStyle} className={className}>
      <img
        src={staticSrc}
        alt={`Pokemon ${pokemonNumber}`}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          imageRendering: "pixelated",
        }}
      />
    </div>
  );
};

export default PokemonCardImage;
