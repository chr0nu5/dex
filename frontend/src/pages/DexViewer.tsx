import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FixedSizeGrid as Grid } from "react-window";
import { Tag, Card, Button, Checkbox } from "antd";
import {
  ThunderboltOutlined,
  SafetyOutlined,
  HeartOutlined,
  StarOutlined,
  FireOutlined,
  TrophyOutlined,
  CrownOutlined,
  GiftOutlined,
  SmileOutlined,
  CheckCircleOutlined,
  HomeOutlined,
  ThunderboltFilled,
} from "@ant-design/icons";
import { getUserId } from "../utils/userId";
import { apiClient } from "../utils/api";
import { getTypeGradient, getTypeBorderColor } from "../utils/pokemonTypes";
import PokemonImage from "../components/PokemonImage";
import "../styles/liquidGlass.css";

interface FileData {
  metadata: {
    filename: string;
    upload_time: string;
    total_pokemon: number;
    enriched: boolean;
  };
  pokemon: any[];
}

interface UserFile {
  file_id: string;
  filename: string;
  upload_time: string;
  enriched: boolean;
  user?: string | null;
  date?: string | null;
}

const CARD_WIDTH = 240;
const CARD_HEIGHT = 380;
const GAP = 48;

const DexViewer: React.FC = () => {
  const { fileId } = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [userFiles, setUserFiles] = useState<UserFile[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [orderBy, setOrderBy] = useState("number");
  const [orderDir, setOrderDir] = useState("asc");
  const [uniqueOnly, setUniqueOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [containerDimensions, setContainerDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight - 80,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const userId = getUserId();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setContainerDimensions({
          width: containerRef.current.clientWidth,
          height: window.innerHeight - 80,
        });
      }
    };

    // Set initial dimensions
    handleResize();

    // Add resize listener
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    loadFileData();
    loadUserFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, debouncedSearch, orderBy, orderDir, uniqueOnly]);

  const loadFileData = async () => {
    if (!fileId) return;

    try {
      setLoading(true);
      const data = await apiClient.getFileData(userId, fileId, {
        search: debouncedSearch,
        order_by: orderBy,
        order_dir: orderDir,
        unique: uniqueOnly,
      });
      setFileData(data);
    } catch (error) {
      console.error("Error loading file data:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadUserFiles = async () => {
    try {
      const response = await apiClient.getUserFiles(userId);
      setUserFiles(response.files || []);
    } catch (error) {
      console.error("Error loading user files:", error);
      setUserFiles([]);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newFileId = event.target.value;
    if (newFileId) {
      navigate(`/dex/${newFileId}`);
    }
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  const handleSortChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    const [field, direction] = value.split("-");
    setOrderBy(field);
    setOrderDir(direction);
  };

  // Calculate tallest height per species for proportional image sizing
  const speciesTallestByDex = useMemo(() => {
    if (!fileData) return {};
    const map: Record<number, number> = {};
    for (const pk of fileData.pokemon) {
      const key = pk.number;
      const h = pk?.height ?? 0;
      if (!map[key] || h > map[key]) map[key] = h;
    }
    return map;
  }, [fileData]);

  const { columnsCount, rowsCount, containerWidth } = useMemo(() => {
    const availableWidth = containerDimensions.width;
    const columnsCount = Math.max(
      1,
      Math.floor(availableWidth / (CARD_WIDTH + GAP))
    );
    const rowsCount = fileData
      ? Math.ceil(fileData.pokemon.length / columnsCount)
      : 0;

    return { columnsCount, rowsCount, containerWidth: availableWidth };
  }, [fileData, containerDimensions.width]);

  const renderPokemonCard = useCallback(
    ({
      columnIndex,
      rowIndex,
      style,
    }: {
      columnIndex: number;
      rowIndex: number;
      style: React.CSSProperties;
    }) => {
      if (!fileData) return null;

      const index = rowIndex * columnsCount + columnIndex;

      if (index >= fileData.pokemon.length) return null;

      const pokemon = fileData.pokemon[index];

      const isShiny = pokemon.shiny || false;
      const isShadow = pokemon.shadow || false;
      const isLucky = pokemon.lucky || false;
      const isPurified = pokemon.purified || false;
      const isApex = pokemon.apex || false;

      // Map lowercase types to uppercase format expected by TYPE_COLORS
      const types = (pokemon.types || []).map(
        (type: string) => `POKEMON_TYPE_${type.toUpperCase()}`
      );
      const typeGradient = getTypeGradient(types);
      const typeBorder = getTypeBorderColor(types);

      return (
        <div
          style={{
            ...style,
            padding: `${GAP / 2}px`,
            boxSizing: "border-box",
          }}
        >
          <div
            className={`pokemon-card ${
              isApex
                ? "apex-card"
                : isShiny
                ? "shiny-card"
                : isShadow
                ? "shadow-card"
                : isPurified
                ? "purified-card"
                : ""
            }`}
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              background:
                isApex || isShiny || isShadow || isPurified
                  ? undefined
                  : typeGradient,
              borderColor:
                isApex || isShiny || isShadow || isPurified
                  ? undefined
                  : typeBorder,
              position: "relative",
            }}
          >
            {/* Dark overlay for better text readability */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background:
                  "linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.45) 100%)",
                pointerEvents: "none",
                zIndex: 1,
              }}
            />

            {/* Lucky Overlay */}
            {isLucky && (
              <img
                src="/img/lucky.png"
                alt="lucky"
                style={{
                  position: "absolute",
                  width: "70%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  bottom: "175px",
                  zIndex: 0,
                  opacity: 0.6,
                  pointerEvents: "none",
                }}
              />
            )}

            {/* Shadow Fire Overlay */}
            {isShadow && (
              <img
                src="/img/shadow.gif"
                alt="shadow"
                style={{
                  position: "absolute",
                  width: "70%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  bottom: "175px",
                  zIndex: 4,
                  opacity: 0.3,
                  pointerEvents: "none",
                }}
              />
            )}

            {/* Purified Overlay */}
            {isPurified && (
              <img
                src="/img/purified.png"
                alt="purified"
                style={{
                  position: "absolute",
                  width: "70%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  bottom: "175px",
                  zIndex: 2,
                  opacity: 0.6,
                  pointerEvents: "none",
                }}
              />
            )}

            <Card
              variant="outlined"
              style={{
                background: "transparent",
                height: "100%",
                display: "flex",
                flexDirection: "column",
              }}
              styles={{
                actions: {
                  background: "rgba(0, 0, 0, 0.7)",
                  backdropFilter: "blur(10px)",
                  borderTop: "1.5px solid rgba(255, 255, 255, 0.2)",
                  padding: "12px 0",
                  margin: "0",
                  position: "relative",
                  zIndex: 2,
                  width: "100%",
                  listStyle: "none",
                },
                body: {
                  padding: "12px",
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                },
              }}
              actions={[
                <div
                  key="attack"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <ThunderboltOutlined
                    style={{
                      fontSize: "20px",
                      color: "#ff4d4f",
                      filter: "drop-shadow(0 2px 4px rgba(255, 77, 79, 0.8))",
                    }}
                  />
                  <span
                    style={{
                      fontSize: "15px",
                      fontWeight: "800",
                      color: "#FFFFFF",
                      textShadow:
                        "0 2px 6px rgba(0,0,0,1), 0 0 8px rgba(255, 77, 79, 0.5)",
                    }}
                  >
                    {pokemon.attack}
                  </span>
                </div>,
                <div
                  key="defense"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <SafetyOutlined
                    style={{
                      fontSize: "20px",
                      color: "#faad14",
                      filter: "drop-shadow(0 2px 4px rgba(250, 173, 20, 0.8))",
                    }}
                  />
                  <span
                    style={{
                      fontSize: "15px",
                      fontWeight: "800",
                      color: "#FFFFFF",
                      textShadow:
                        "0 2px 6px rgba(0,0,0,1), 0 0 8px rgba(250, 173, 20, 0.5)",
                    }}
                  >
                    {pokemon.defence}
                  </span>
                </div>,
                <div
                  key="stamina"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <HeartOutlined
                    style={{
                      fontSize: "20px",
                      color: "#eb2f96",
                      filter: "drop-shadow(0 2px 4px rgba(235, 47, 150, 0.8))",
                    }}
                  />
                  <span
                    style={{
                      fontSize: "15px",
                      fontWeight: "800",
                      color: "#FFFFFF",
                      textShadow:
                        "0 2px 6px rgba(0,0,0,1), 0 0 8px rgba(235, 47, 150, 0.5)",
                    }}
                  >
                    {pokemon.stamina}
                  </span>
                </div>,
              ]}
            >
              {/* Pokemon Badges */}
              <div
                style={{
                  display: "inline-flex",
                  gap: "8px",
                  justifyContent: "center",
                  marginBottom: "8px",
                  background: "rgba(0, 0, 0, 0.85)",
                  borderRadius: "20px",
                  padding: "8px 14px",
                  boxShadow:
                    "0 4px 12px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
                  border: "1.5px solid rgba(255, 255, 255, 0.2)",
                  minHeight: "36px",
                  alignItems: "center",
                  position: "relative",
                  zIndex: 2,
                }}
              >
                {!isApex &&
                !isShiny &&
                !isShadow &&
                !isPurified &&
                !isLucky &&
                !pokemon.legendary &&
                !pokemon.mythic ? (
                  <CheckCircleOutlined
                    style={{
                      fontSize: "20px",
                      color: "#95a5a6",
                      filter: "drop-shadow(0 0 4px rgba(149, 165, 166, 0.5))",
                    }}
                    title="Normal"
                  />
                ) : (
                  <>
                    {isApex && (
                      <ThunderboltFilled
                        style={{
                          fontSize: "22px",
                          color: "#FF00FF",
                          filter:
                            "drop-shadow(0 0 10px rgba(255, 0, 255, 1)) drop-shadow(0 0 15px rgba(0, 255, 255, 0.8)) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.9))",
                        }}
                        title="Apex"
                      />
                    )}
                    {isShiny && (
                      <StarOutlined
                        style={{
                          fontSize: "22px",
                          color: "#FFD700",
                          filter:
                            "drop-shadow(0 0 8px rgba(255, 215, 0, 1)) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.9))",
                        }}
                        title="Shiny"
                      />
                    )}
                    {isShadow && (
                      <FireOutlined
                        style={{
                          fontSize: "22px",
                          color: "#8B2BE2",
                          filter:
                            "drop-shadow(0 0 8px rgba(138, 43, 226, 1)) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.9))",
                        }}
                        title="Shadow"
                      />
                    )}
                    {isPurified && (
                      <SmileOutlined
                        style={{
                          fontSize: "22px",
                          color: "#FFFFFF",
                          filter:
                            "drop-shadow(0 0 8px rgba(255, 255, 255, 1)) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.9))",
                        }}
                        title="Purified"
                      />
                    )}
                    {isLucky && (
                      <GiftOutlined
                        style={{
                          fontSize: "22px",
                          color: "#FFA500",
                          filter:
                            "drop-shadow(0 0 8px rgba(255, 165, 0, 1)) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.9))",
                        }}
                        title="Lucky"
                      />
                    )}
                    {pokemon.legendary && (
                      <TrophyOutlined
                        style={{
                          fontSize: "22px",
                          color: "#FF6347",
                          filter:
                            "drop-shadow(0 0 8px rgba(255, 99, 71, 1)) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.9))",
                        }}
                        title="Legendary"
                      />
                    )}
                    {pokemon.mythic && (
                      <CrownOutlined
                        style={{
                          fontSize: "22px",
                          color: "#9B59B6",
                          filter:
                            "drop-shadow(0 0 8px rgba(155, 89, 182, 1)) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.9))",
                        }}
                        title="Mythical"
                      />
                    )}
                  </>
                )}
              </div>

              {/* Image Container */}
              <div
                style={{
                  width: "100%",
                  height: "120px",
                  display: "flex",
                  alignItems: "end",
                  justifyContent: "center",
                  marginBottom: "12px",
                  position: "relative",
                  zIndex: 3,
                }}
              >
                <PokemonImage
                  staticSrc={
                    pokemon.image ? `/${pokemon.image}` : "/img/placeholder.png"
                  }
                  alt={pokemon.name}
                  className={
                    isApex
                      ? "pokemon-apex"
                      : isShiny
                      ? "pokemon-shiny"
                      : isShadow
                      ? "pokemon-shadow"
                      : isPurified
                      ? "pokemon-purified"
                      : ""
                  }
                  pokemonHeight={pokemon.height || 1}
                  tallestHeight={
                    speciesTallestByDex[pokemon.number] || pokemon.height || 1
                  }
                  containerWidth={CARD_WIDTH}
                  containerHeight={120}
                  minPx={60}
                />
              </div>

              {/* Pokemon Info */}
              <div
                style={{ textAlign: "center", position: "relative", zIndex: 2 }}
              >
                {/* Name and IV Tags */}
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    justifyContent: "center",
                    marginBottom: "10px",
                  }}
                >
                  <Tag
                    style={{
                      margin: 0,
                      fontWeight: "600",
                      fontSize: "12px",
                      borderRadius: "8px",
                      padding: "4px 10px",
                      background: "#1e1e2e",
                      border: "1px solid #3a3a54",
                      color: "#e0e0e0",
                      boxShadow: "0 2px 6px rgba(0, 0, 0, 0.4)",
                    }}
                  >
                    {pokemon.gender_symbol && pokemon.gender_symbol !== "⚲" && (
                      <span style={{ marginRight: "4px" }}>
                        {pokemon.gender_symbol}
                      </span>
                    )}
                    {pokemon.name}
                  </Tag>
                  <Tag
                    style={{
                      margin: 0,
                      fontWeight: "600",
                      fontSize: "12px",
                      borderRadius: "8px",
                      padding: "4px 10px",
                      background:
                        pokemon.iv >= 90
                          ? "#2d4a2e"
                          : pokemon.iv >= 80
                          ? "#2d3a54"
                          : pokemon.iv >= 70
                          ? "#3a3a2e"
                          : "#4a2e2e",
                      border:
                        pokemon.iv >= 90
                          ? "1px solid #4a7c4d"
                          : pokemon.iv >= 80
                          ? "1px solid #4a5c7c"
                          : pokemon.iv >= 70
                          ? "1px solid #6c6c4a"
                          : "1px solid #7c4a4a",
                      color:
                        pokemon.iv >= 90
                          ? "#88cc88"
                          : pokemon.iv >= 80
                          ? "#88aacc"
                          : pokemon.iv >= 70
                          ? "#cccc88"
                          : "#cc8888",
                      boxShadow: "0 2px 6px rgba(0, 0, 0, 0.4)",
                    }}
                  >
                    {pokemon.iv.toFixed(1)}%
                  </Tag>
                </div>

                {/* CP and Size Tags */}
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    justifyContent: "center",
                  }}
                >
                  <Tag
                    style={{
                      margin: 0,
                      fontWeight: "600",
                      fontSize: "12px",
                      borderRadius: "8px",
                      padding: "4px 10px",
                      background: "#1e1e2e",
                      border: "1px solid #3a3a54",
                      color: "#e0e0e0",
                      boxShadow: "0 2px 6px rgba(0, 0, 0, 0.4)",
                    }}
                  >
                    CP {pokemon.cp}
                  </Tag>
                  {(pokemon.height_label || pokemon.weight_label) && (
                    <Tag
                      style={{
                        margin: 0,
                        fontWeight: "600",
                        fontSize: "12px",
                        borderRadius: "8px",
                        padding: "4px 10px",
                        background: "#3a2e2e",
                        border: "1px solid #6c4a3a",
                        color: "#cc9966",
                        boxShadow: "0 2px 6px rgba(0, 0, 0, 0.4)",
                      }}
                    >
                      {pokemon.height_label?.toUpperCase() ||
                        pokemon.weight_label?.toUpperCase()}
                    </Tag>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </div>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fileData, columnsCount]
  );

  return (
    <div style={{ minHeight: "100vh", paddingTop: "80px" }}>
      <header className="liquid-glass-header">
        <Button
          icon={<HomeOutlined />}
          onClick={() => navigate("/")}
          style={{
            background: "linear-gradient(145deg, #2d2d44, #3a3a54)",
            border: "1px solid #4a4a6a",
            color: "#e0e0e0",
            height: "48px",
            borderRadius: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "48px",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#5555ff";
            e.currentTarget.style.boxShadow =
              "0 4px 12px rgba(85, 85, 255, 0.3)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#4a4a6a";
            e.currentTarget.style.boxShadow = "none";
          }}
        />

        <select
          className="liquid-glass-select"
          value={fileId || ""}
          onChange={handleFileChange}
        >
          {userFiles.map((file) => {
            let displayName = file.filename.replace(".json", "");

            if (file.user && file.date) {
              // Format date to DD/MM/YYYY
              const date = new Date(file.date);
              const formattedDate = date.toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              });
              displayName = `${file.user} - ${formattedDate}`;
            }

            return (
              <option key={file.file_id} value={file.file_id}>
                {displayName}
              </option>
            );
          })}
        </select>

        <input
          type="text"
          className="liquid-glass-input"
          placeholder="Search Pokémon..."
          value={searchQuery}
          onChange={handleSearchChange}
          style={{ flex: 1, minWidth: "200px" }}
        />

        <div
          style={{
            background: "linear-gradient(145deg, #2d2d44, #3a3a54)",
            border: "1px solid #4a4a6a",
            borderRadius: "12px",
            padding: "0 18px",
            height: "48px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <Checkbox
            checked={uniqueOnly}
            onChange={(e) => setUniqueOnly(e.target.checked)}
            style={{
              color: "#e0e0e0",
            }}
          >
            <span
              style={{
                color: "#ffffff",
                fontWeight: "500",
                fontSize: "14px",
              }}
            >
              Unique
            </span>
          </Checkbox>
        </div>

        <div
          style={{
            background: "linear-gradient(145deg, #2d2d44, #3a3a54)",
            border: "1px solid #4a4a6a",
            borderRadius: "12px",
            padding: "0 18px",
            height: "48px",
            display: "flex",
            alignItems: "center",
            color: "#ffffff",
            fontWeight: "600",
            fontSize: "16px",
            whiteSpace: "nowrap",
          }}
        >
          {fileData ? fileData.pokemon.length : 0}{" "}
          {fileData && fileData.pokemon.length > 1 ? "Pokémons" : "Pokémon"}
        </div>

        <select
          className="liquid-glass-select"
          value={`${orderBy}-${orderDir}`}
          onChange={handleSortChange}
          style={{ minWidth: "180px" }}
        >
          <option value="number-asc">Number ↑</option>
          <option value="number-desc">Number ↓</option>
          <option value="name-asc">Name ↑</option>
          <option value="name-desc">Name ↓</option>
          <option value="cp-asc">CP ↑</option>
          <option value="cp-desc">CP ↓</option>
          <option value="height-asc">Height ↑</option>
          <option value="height-desc">Height ↓</option>
          <option value="weight-asc">Weight ↑</option>
          <option value="weight-desc">Weight ↓</option>
          <option value="iv-asc">IV ↑</option>
          <option value="iv-desc">IV ↓</option>
          <option value="attack-asc">Attack ↑</option>
          <option value="attack-desc">Attack ↓</option>
          <option value="defense-asc">Defense ↑</option>
          <option value="defense-desc">Defense ↓</option>
          <option value="stamina-asc">Stamina ↑</option>
          <option value="stamina-desc">Stamina ↓</option>
        </select>
      </header>

      <div
        ref={containerRef}
        style={{
          padding: "0px",
          height: "calc(100vh - 80px)",
          width: "100%",
          boxSizing: "border-box",
          overflow: "visible",
        }}
      >
        {loading ? (
          <div
            style={{
              textAlign: "center",
              color: "white",
              fontSize: "18px",
              paddingTop: "100px",
            }}
          >
            Loading...
          </div>
        ) : fileData && fileData.pokemon.length > 0 ? (
          <Grid
            columnCount={columnsCount}
            columnWidth={CARD_WIDTH + GAP}
            height={containerDimensions.height}
            rowCount={rowsCount}
            rowHeight={CARD_HEIGHT + GAP}
            width={containerWidth}
          >
            {renderPokemonCard as any}
          </Grid>
        ) : fileData ? (
          <div
            style={{
              textAlign: "center",
              color: "white",
              fontSize: "18px",
              paddingTop: "100px",
            }}
          >
            No Pokémon found
          </div>
        ) : (
          <div
            style={{
              textAlign: "center",
              color: "white",
              fontSize: "18px",
              paddingTop: "100px",
            }}
          >
            No file selected
          </div>
        )}
      </div>
    </div>
  );
};

export default DexViewer;
