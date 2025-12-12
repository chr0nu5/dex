import React, { useState, useEffect, useMemo } from "react";

interface PokemonImageProps {
  staticSrc: string;
  animatedSrc?: string;
  className?: string;
  alt: string;
  pokemonHeight?: number;
  tallestHeight?: number;
  containerWidth?: number;
  containerHeight?: number;
  minPx?: number;
  heightMultiplier?: number;
}

const S3_BASE_URL = "https://s3.us-west-004.backblazeb2.com/pokedeiz/animated/";

const PokemonImage: React.FC<PokemonImageProps> = ({
  staticSrc,
  animatedSrc,
  className = "",
  alt,
  pokemonHeight = 1,
  tallestHeight = 1,
  containerWidth = 240,
  containerHeight = 120,
  minPx = 60,
  heightMultiplier = 1,
}) => {
  const [imgSrc, setImgSrc] = useState<string>(staticSrc);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Calculate target height based on Pokemon's actual height
  const targetHeightPx = useMemo(() => {
    const maxSpriteHeight = Math.max(1, containerHeight * 0.9);
    const ratio = Math.max(
      0,
      Math.min(1, pokemonHeight / (tallestHeight || 1))
    );
    const h = ratio * maxSpriteHeight;
    const calculatedHeight = Math.max(minPx, Math.min(h, maxSpriteHeight));
    // Double the size for static images (when no animatedSrc)
    return animatedSrc ? calculatedHeight / 1.2 : calculatedHeight * 3;
  }, [pokemonHeight, tallestHeight, containerHeight, minPx, animatedSrc]);

  const finalHeightPx = useMemo(() => {
    const m = Number.isFinite(heightMultiplier) ? heightMultiplier : 1;
    return targetHeightPx * (m > 0 ? m : 1);
  }, [targetHeightPx, heightMultiplier]);

  useEffect(() => {
    // Reset to animated on mount if available
    if (animatedSrc) {
      setIsLoading(true);
      const fullAnimatedUrl = `${S3_BASE_URL}${animatedSrc}`;

      // Preload animated image
      const img = new Image();
      img.src = fullAnimatedUrl;

      img.onload = () => {
        setImgSrc(fullAnimatedUrl);
        setIsLoading(false);
      };

      img.onerror = () => {
        // Fallback to static
        setImgSrc(staticSrc);
        setIsLoading(false);
      };
    } else {
      setImgSrc(staticSrc);
      setIsLoading(false);
    }
  }, [animatedSrc, staticSrc]);

  return (
    <img
      src={imgSrc}
      alt={alt}
      className={className}
      style={{
        height: `${finalHeightPx}px`,
        width: "auto",
        maxWidth: `${containerWidth}px`,
        maxHeight: `${
          containerHeight * 1.1 * (heightMultiplier > 0 ? heightMultiplier : 1)
        }px`,
        objectFit: "contain",
        imageRendering: "pixelated",
        opacity: isLoading ? 0.5 : 1,
        transition: "opacity 0.2s ease-in-out",
      }}
    />
  );
};

export default PokemonImage;
