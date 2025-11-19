import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FixedSizeGrid as Grid } from "react-window";
import { Tag, Card, Button } from "antd";
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
const CARD_HEIGHT = 340;
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
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const userId = getUserId();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    loadFileData();
    loadUserFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, debouncedSearch, orderBy, orderDir]);

  const loadFileData = async () => {
    if (!fileId) return;

    try {
      setLoading(true);
      const data = await apiClient.getFileData(userId, fileId, {
        search: debouncedSearch,
        order_by: orderBy,
        order_dir: orderDir,
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
    const containerWidth =
      containerRef.current?.clientWidth || window.innerWidth;
    const availableWidth = containerWidth; // Account for padding
    const columnsCount = Math.max(
      1,
      Math.floor(availableWidth / (CARD_WIDTH + GAP))
    );
    const rowsCount = fileData
      ? Math.ceil(fileData.pokemon.length / columnsCount)
      : 0;

    return { columnsCount, rowsCount, containerWidth: availableWidth };
  }, [fileData]); // eslint-disable-line react-hooks/exhaustive-deps

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
                  bottom: "145px",
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
              bordered={false}
              style={{
                background: "transparent",
                height: "100%",
                display: "flex",
                flexDirection: "column",
              }}
              bodyStyle={{
                padding: "12px",
                flex: 1,
                display: "flex",
                flexDirection: "column",
              }}
              styles={{
                actions: {
                  background: "transparent",
                  borderTop: "none",
                },
              }}
              actions={[
                <div
                  key="attack"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                  }}
                >
                  <ThunderboltOutlined
                    style={{ fontSize: "18px", color: "#ff4d4f" }}
                  />
                  <span
                    style={{
                      fontSize: "14px",
                      fontWeight: "700",
                      color: "white",
                      textShadow: "0 1px 3px rgba(0,0,0,0.8)",
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
                  }}
                >
                  <SafetyOutlined
                    style={{ fontSize: "18px", color: "#faad14" }}
                  />
                  <span
                    style={{
                      fontSize: "14px",
                      fontWeight: "700",
                      color: "white",
                      textShadow: "0 1px 3px rgba(0,0,0,0.8)",
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
                  }}
                >
                  <HeartOutlined
                    style={{ fontSize: "18px", color: "#eb2f96" }}
                  />
                  <span
                    style={{
                      fontSize: "14px",
                      fontWeight: "700",
                      color: "white",
                      textShadow: "0 1px 3px rgba(0,0,0,0.8)",
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
                  background: "rgba(0, 0, 0, 0.4)",
                  borderRadius: "20px",
                  padding: "6px 12px",
                  boxShadow:
                    "0 2px 8px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  minHeight: "32px",
                  alignItems: "center",
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
                          fontSize: "20px",
                          color: "#FF00FF",
                          filter:
                            "drop-shadow(0 0 8px rgba(255, 0, 255, 0.9)) drop-shadow(0 0 12px rgba(0, 255, 255, 0.6))",
                        }}
                        title="Apex"
                      />
                    )}
                    {isShiny && (
                      <StarOutlined
                        style={{
                          fontSize: "20px",
                          color: "#FFD700",
                          filter: "drop-shadow(0 0 6px rgba(255, 215, 0, 0.8))",
                        }}
                        title="Shiny"
                      />
                    )}
                    {isShadow && (
                      <FireOutlined
                        style={{
                          fontSize: "20px",
                          color: "#8B2BE2",
                          filter:
                            "drop-shadow(0 0 6px rgba(138, 43, 226, 0.8))",
                        }}
                        title="Shadow"
                      />
                    )}
                    {isPurified && (
                      <SmileOutlined
                        style={{
                          fontSize: "20px",
                          color: "#FFFFFF",
                          filter:
                            "drop-shadow(0 0 6px rgba(255, 255, 255, 0.8))",
                        }}
                        title="Purified"
                      />
                    )}
                    {isLucky && (
                      <GiftOutlined
                        style={{
                          fontSize: "20px",
                          color: "#FFA500",
                          filter: "drop-shadow(0 0 6px rgba(255, 165, 0, 0.8))",
                        }}
                        title="Lucky"
                      />
                    )}
                    {pokemon.legendary && (
                      <TrophyOutlined
                        style={{
                          fontSize: "20px",
                          color: "#FF6347",
                          filter: "drop-shadow(0 0 6px rgba(255, 99, 71, 0.8))",
                        }}
                        title="Legendary"
                      />
                    )}
                    {pokemon.mythic && (
                      <CrownOutlined
                        style={{
                          fontSize: "20px",
                          color: "#9B59B6",
                          filter:
                            "drop-shadow(0 0 6px rgba(155, 89, 182, 0.8))",
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
                  animatedSrc={
                    pokemon.image_animated && !pokemon.costume
                      ? pokemon.image_animated
                      : undefined
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
              <div style={{ textAlign: "center" }}>
                {/* Name and IV Tags */}
                <div
                  style={{
                    display: "flex",
                    gap: "6px",
                    justifyContent: "center",
                    marginBottom: "12px",
                  }}
                >
                  <Tag
                    color="cyan"
                    style={{
                      margin: 0,
                      fontWeight: "600",
                      fontSize: "13px",
                      borderRadius: "12px",
                      padding: "4px 12px",
                      color: "#000000",
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
                    color={
                      pokemon.iv >= 90
                        ? "gold"
                        : pokemon.iv >= 80
                        ? "blue"
                        : pokemon.iv >= 70
                        ? "green"
                        : "volcano"
                    }
                    style={{
                      margin: 0,
                      fontWeight: "600",
                      fontSize: "13px",
                      borderRadius: "12px",
                      padding: "4px 12px",
                    }}
                  >
                    {pokemon.iv.toFixed(1)}%
                  </Tag>
                </div>

                {/* CP and Size Tags */}
                <div
                  style={{
                    display: "flex",
                    gap: "4px",
                    justifyContent: "center",
                  }}
                >
                  <Tag
                    style={{
                      fontWeight: "500",
                      fontSize: "11px",
                      borderRadius: "8px",
                      padding: "2px 8px",
                      background: "rgba(0, 0, 0, 0.4)",
                      border: "1px solid rgba(255, 255, 255, 0.25)",
                      color: "rgba(255, 255, 255, 0.9)",
                    }}
                  >
                    CP {pokemon.cp}
                  </Tag>
                  {(pokemon.height_label || pokemon.weight_label) && (
                    <Tag
                      style={{
                        fontWeight: "600",
                        fontSize: "11px",
                        borderRadius: "8px",
                        padding: "2px 8px",
                        background: "rgba(255, 165, 0, 0.3)",
                        border: "1px solid rgba(255, 165, 0, 0.6)",
                        color: "rgba(255, 255, 255, 0.95)",
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
    [fileData, columnsCount]
  );

  return (
    <div style={{ minHeight: "100vh", paddingTop: "80px" }}>
      <header className="liquid-glass-header">
        <Button
          icon={<HomeOutlined />}
          onClick={() => navigate("/")}
          style={{
            background: "rgba(255, 255, 255, 0.08)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            color: "rgba(255, 255, 255, 0.95)",
            height: "48px",
            borderRadius: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "48px",
          }}
        />

        <select
          className="liquid-glass-select"
          value={fileId || ""}
          onChange={handleFileChange}
        >
          <option value="">Select a file...</option>
          {userFiles.map((file) => (
            <option key={file.file_id} value={file.file_id}>
              {file.user && file.date
                ? `${file.user} - ${file.date}`
                : file.filename.replace(".json", "")}
            </option>
          ))}
        </select>

        <input
          type="text"
          className="liquid-glass-input"
          placeholder="Search Pokémon..."
          value={searchQuery}
          onChange={handleSearchChange}
        />

        <div
          style={{
            background: "rgba(255, 255, 255, 0.08)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            borderRadius: "12px",
            padding: "0 18px",
            height: "48px",
            display: "flex",
            alignItems: "center",
            color: "rgba(255, 255, 255, 0.95)",
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
            height={window.innerHeight - 80}
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
