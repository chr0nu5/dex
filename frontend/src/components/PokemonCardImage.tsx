import React, { useState, useEffect } from "react";

interface PokemonCardImageProps {
  pokemonNumber: number; // Dex number (e.g., 1, 25, 150)
  staticSrc: string; // Path to static icon
  animatedSrc?: string; // Path to animated GIF (optional)
  width?: number;
  height?: number;
  use3D?: boolean; // Force 3D on/off (deprecated, always false now)
  className?: string;
}

const PokemonCardImage: React.FC<PokemonCardImageProps> = ({
  pokemonNumber,
  staticSrc,
  animatedSrc,
  width = 96,
  height = 96,
  className = "",
}) => {
  const [imageType, setImageType] = useState<"animated" | "static">(
    animatedSrc ? "animated" : "static"
  );
  const [animatedLoaded, setAnimatedLoaded] = useState(false);

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
