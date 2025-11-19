// Pokemon type colors for liquid glass effect
export const TYPE_COLORS: Record<
  string,
  { primary: string; secondary: string; shadow: string }
> = {
  NORMAL: {
    primary: "rgba(168, 167, 122, 0.9)",
    secondary: "rgba(168, 167, 122, 1)",
    shadow: "rgba(168, 167, 122, 0.9)",
  },
  FIRE: {
    primary: "rgba(238, 129, 48, 0.9)",
    secondary: "rgba(238, 129, 48, 1)",
    shadow: "rgba(238, 129, 48, 0.9)",
  },
  WATER: {
    primary: "rgba(99, 144, 240, 0.9)",
    secondary: "rgba(99, 144, 240, 1)",
    shadow: "rgba(99, 144, 240, 0.9)",
  },
  ELECTRIC: {
    primary: "rgba(247, 208, 44, 0.9)",
    secondary: "rgba(247, 208, 44, 1)",
    shadow: "rgba(247, 208, 44, 0.9)",
  },
  GRASS: {
    primary: "rgba(122, 199, 76, 0.9)",
    secondary: "rgba(122, 199, 76, 1)",
    shadow: "rgba(122, 199, 76, 0.9)",
  },
  ICE: {
    primary: "rgba(150, 217, 214, 0.9)",
    secondary: "rgba(150, 217, 214, 1)",
    shadow: "rgba(150, 217, 214, 0.9)",
  },
  FIGHTING: {
    primary: "rgba(194, 46, 40, 0.9)",
    secondary: "rgba(194, 46, 40, 1)",
    shadow: "rgba(194, 46, 40, 0.9)",
  },
  POISON: {
    primary: "rgba(163, 62, 161, 0.9)",
    secondary: "rgba(163, 62, 161, 1)",
    shadow: "rgba(163, 62, 161, 0.9)",
  },
  GROUND: {
    primary: "rgba(226, 191, 101, 0.9)",
    secondary: "rgba(226, 191, 101, 1)",
    shadow: "rgba(226, 191, 101, 0.9)",
  },
  FLYING: {
    primary: "rgba(169, 143, 243, 0.9)",
    secondary: "rgba(169, 143, 243, 1)",
    shadow: "rgba(169, 143, 243, 0.9)",
  },
  PSYCHIC: {
    primary: "rgba(249, 85, 135, 0.9)",
    secondary: "rgba(249, 85, 135, 1)",
    shadow: "rgba(249, 85, 135, 0.9)",
  },
  BUG: {
    primary: "rgba(166, 185, 26, 0.9)",
    secondary: "rgba(166, 185, 26, 1)",
    shadow: "rgba(166, 185, 26, 0.9)",
  },
  ROCK: {
    primary: "rgba(182, 161, 54, 0.9)",
    secondary: "rgba(182, 161, 54, 1)",
    shadow: "rgba(182, 161, 54, 0.9)",
  },
  GHOST: {
    primary: "rgba(115, 87, 151, 0.9)",
    secondary: "rgba(115, 87, 151, 1)",
    shadow: "rgba(115, 87, 151, 0.9)",
  },
  DRAGON: {
    primary: "rgba(111, 53, 252, 0.9)",
    secondary: "rgba(111, 53, 252, 1)",
    shadow: "rgba(111, 53, 252, 0.9)",
  },
  DARK: {
    primary: "rgba(112, 87, 70, 0.9)",
    secondary: "rgba(112, 87, 70, 1)",
    shadow: "rgba(112, 87, 70, 0.9)",
  },
  STEEL: {
    primary: "rgba(183, 183, 206, 0.9)",
    secondary: "rgba(183, 183, 206, 1)",
    shadow: "rgba(183, 183, 206, 0.9)",
  },
  FAIRY: {
    primary: "rgba(214, 133, 173, 0.9)",
    secondary: "rgba(214, 133, 173, 1)",
    shadow: "rgba(214, 133, 173, 0.9)",
  },
};

const GRAY_FALLBACK = {
  primary: "rgba(120, 120, 120, 0.5)",
  secondary: "rgba(120, 120, 120, 0.5)",
  shadow: "rgba(120, 120, 120, 0.5)",
};

export const getTypeGradient = (types: string[]): string => {
  if (!types || types.length === 0) {
    return GRAY_FALLBACK.primary;
  }

  const type1 = types[0]?.replace("POKEMON_TYPE_", "");
  const type2 = types[1]?.replace("POKEMON_TYPE_", "");

  if (types.length === 1) {
    const color = TYPE_COLORS[type1] || GRAY_FALLBACK;
    return color.primary;
  }

  const color1 = TYPE_COLORS[type1] || GRAY_FALLBACK;
  const color2 = TYPE_COLORS[type2] || GRAY_FALLBACK;

  return `linear-gradient(135deg, ${color1.primary} 0%, ${color2.primary} 100%)`;
};

export const getTypeBorderColor = (types: string[]): string => {
  if (!types || types.length === 0) {
    return GRAY_FALLBACK.shadow;
  }

  const type1 = types[0]?.replace("POKEMON_TYPE_", "");
  const color = TYPE_COLORS[type1] || GRAY_FALLBACK;

  return color.shadow;
};
