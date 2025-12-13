import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FixedSizeGrid as Grid } from "react-window";
import {
  Tag,
  Card,
  Button,
  Switch,
  message,
  Progress,
  Select,
  Popconfirm,
} from "antd";
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
  DeleteOutlined,
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
  teams?: Array<{
    score: number;
    members: any[];
    summary?: {
      score: number;
      strengths?: Array<{ id: string; name: string; rating: number }>;
      weaknesses?: Array<{ id: string; name: string; rating: number }>;
    };
  }>;
  best_teams?: {
    league: "GL" | "UL" | "ML";
    category: string;
    pool_size: number;
  };
}

interface UserFile {
  file_id: string;
  filename: string;
  upload_time: string;
  enriched: boolean;
  user?: string | null;
  date?: string | null;
}

interface ProgressData {
  current: number;
  total: number;
  status: string;
}

const SORT_OPTIONS = [
  { value: "captured-desc", label: "Newest" },
  { value: "captured-asc", label: "Oldest" },
  { value: "number-asc", label: "Number ↑" },
  { value: "number-desc", label: "Number ↓" },
  { value: "name-asc", label: "Name ↑" },
  { value: "name-desc", label: "Name ↓" },
  { value: "cp-asc", label: "CP ↑" },
  { value: "cp-desc", label: "CP ↓" },
  { value: "height-asc", label: "Height ↑" },
  { value: "height-desc", label: "Height ↓" },
  { value: "weight-asc", label: "Weight ↑" },
  { value: "weight-desc", label: "Weight ↓" },
  { value: "iv-asc", label: "IV ↑" },
  { value: "iv-desc", label: "IV ↓" },
  { value: "attack-asc", label: "Attack ↑" },
  { value: "attack-desc", label: "Attack ↓" },
  { value: "defense-asc", label: "Defense ↑" },
  { value: "defense-desc", label: "Defense ↓" },
  { value: "stamina-asc", label: "Stamina ↑" },
  { value: "stamina-desc", label: "Stamina ↓" },
];

const CARD_WIDTH = 240;
const CARD_HEIGHT = 380;
const GAP = 48;

const DETAILS_SQUARE_PX = CARD_WIDTH + GAP;
const DETAILS_PANEL_TOP_PX = Math.round((DETAILS_SQUARE_PX * 2) / 3);

// CP formula helpers (Pokemon GO). We use Level 50 max CPM.
const MAX_CPM_L50 = 0.84029999;

const calcMaxCp = (pokemon: any): number | null => {
  const baseAtk = Number(pokemon?.base_attack ?? pokemon?.base_atk);
  const baseDef = Number(pokemon?.base_defence ?? pokemon?.base_defense);
  const baseSta = Number(pokemon?.base_stamina);

  if (![baseAtk, baseDef, baseSta].every((n) => Number.isFinite(n)))
    return null;

  const iva = 15;
  const ivd = 15;
  const ivs = 15;
  const cpm = MAX_CPM_L50;

  const raw =
    ((baseAtk + iva) *
      Math.sqrt(baseDef + ivd) *
      Math.sqrt(baseSta + ivs) *
      cpm *
      cpm) /
    10;

  const cp = Math.floor(raw);
  return Number.isFinite(cp) && cp > 0 ? cp : null;
};

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const toTitleCaseName = (raw: any): string => {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
};

const TYPE_BG_ALLOWED = new Set([
  "bug",
  "dark",
  "dragon",
  "electric",
  "fairy",
  "fighting",
  "fire",
  "flying",
  "ghost",
  "grass",
  "ground",
  "ice",
  "normal",
  "poison",
  "psychic",
  "rock",
  "steel",
  "water",
  "default",
]);

const getTypeBackgroundUrl = (pokemon: any): string => {
  const t0 = (pokemon?.types || [])[0];
  const typeKey = TYPE_BG_ALLOWED.has(String(t0 || "").toLowerCase())
    ? String(t0).toLowerCase()
    : "default";
  return `/img/backgrounds/types/details_type_bg_${typeKey}.png`;
};

const getLocationCardKey = (pokemon: any): string => {
  const extract = (v: any): string => {
    const s = String(v || "").trim();
    if (!s) return "";
    // Only accept the canonical string form.
    if (!s.startsWith("LocationCard_")) return "";
    const lower = s.toLowerCase();
    // Treat Unset values as "no location card".
    if (lower === "locationcard_unset") return "";
    if (lower.includes("unset")) return "";
    return s;
  };

  // Prefer the SpeedUnlocker schema: display.locationCard.name
  const fromDisplay = extract(pokemon?.display?.locationCard?.name);
  if (fromDisplay) return fromDisplay;

  // Fallback to raw record preserved under source
  const fromSource = extract(pokemon?.source?.display?.locationCard?.name);
  if (fromSource) return fromSource;

  // Other possible shapes
  const fromTopLevelObj = extract(pokemon?.locationCard?.name);
  if (fromTopLevelObj) return fromTopLevelObj;
  const fromTopLevel = extract(pokemon?.locationCard);
  if (fromTopLevel) return fromTopLevel;

  const fromDisplayName = extract(pokemon?.display?.locationCardName);
  if (fromDisplayName) return fromDisplayName;

  return "";
};

const getCardBackgroundImage = (pokemon: any): string => {
  const typeBgUrl = getTypeBackgroundUrl(pokemon);
  const locationKey = getLocationCardKey(pokemon);
  if (!locationKey) return `url(${typeBgUrl})`;

  // Some keys in our mapping/files use a slightly different casing for "SpecialBackground".
  const altKey = locationKey.includes("LcSpecialBackground")
    ? locationKey.replace("LcSpecialBackground", "LcSpecialbackground")
    : locationKey.includes("LcSpecialbackground")
    ? locationKey.replace("LcSpecialbackground", "LcSpecialBackground")
    : "";

  // Prefer .jpg (matches the downloaded assets); keep type background as final fallback.
  if (altKey && altKey !== locationKey) {
    return `url(/img/backgrounds/location/${locationKey}.jpg), url(/img/backgrounds/location/${altKey}.jpg), url(${typeBgUrl})`;
  }
  return `url(/img/backgrounds/location/${locationKey}.jpg), url(${typeBgUrl})`;
};

const getIvGradientColor = (ivRaw: any): string => {
  const iv = Number(ivRaw);
  if (!Number.isFinite(iv)) return "#FFFFFF";

  const t = Math.max(0, Math.min(1, iv / 15));

  // NOTE: You asked for "vermelho #FFF" -> green; #FFF is white, so we assume
  // a red-to-green gradient using the existing red token as the start.
  const start = { r: 255, g: 77, b: 79 }; // #ff4d4f
  const end = { r: 74, g: 124, b: 77 }; // rgb(74, 124, 77)

  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${lerp(start.r, end.r)}, ${lerp(start.g, end.g)}, ${lerp(
    start.b,
    end.b
  )})`;
};

type PokeballMeta = { url: string; label: string };

const getPokeballMeta = (pokemon: any): PokeballMeta | null => {
  const idRaw = pokemon?.pokeball_id ?? pokemon?.pokeballId;
  const id = typeof idRaw === "number" ? idRaw : Number(idRaw);
  const raw = String(pokemon?.pokeball ?? "").toLowerCase();

  // Prefer explicit IDs when present.
  if (id === 4 || raw.includes("master")) {
    return { url: "/img/icons/masterball_sprite.png", label: "Master Ball" };
  }
  if (id === 3 || raw.includes("ultra")) {
    return { url: "/img/icons/ultraball_sprite.png", label: "Ultra Ball" };
  }
  if (id === 2 || raw.includes("great")) {
    return { url: "/img/icons/greatball_sprite.png", label: "Great Ball" };
  }
  if (raw.includes("wild")) {
    return { url: "/img/icons/wildball_sprite.png", label: "Wild Ball" };
  }
  if (id === 1 || raw.includes("pokeball")) {
    return { url: "/img/icons/pokeball_sprite.png", label: "Poké Ball" };
  }
  if (id === 5 || raw.includes("premier")) {
    return { url: "/img/icons/premierball_sprite.png", label: "Poké Ball" };
  }

  // No supported icon (e.g. Premier Ball) -> hide.
  return null;
};

const DexViewer: React.FC = () => {
  const { fileId } = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [userFiles, setUserFiles] = useState<UserFile[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [orderBy, setOrderBy] = useState("captured");
  const [orderDir, setOrderDir] = useState("desc");
  const [uniqueOnly, setUniqueOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);
  const [snorlaxOpen, setSnorlaxOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [uploadFileId, setUploadFileId] = useState<string | null>(null);
  const [uploadQueue, setUploadQueue] = useState<File[]>([]);
  const [currentUploadName, setCurrentUploadName] = useState<string | null>(
    null
  );
  const [pvpEnabled, setPvpEnabled] = useState(false);
  const [pvpLeague, setPvpLeague] = useState<"GL" | "UL" | "ML">("GL");
  const [pvpCategory, setPvpCategory] = useState("overall");

  type PokemonDetailsState = {
    pokemon: any;
    origin: { top: number; left: number; width: number; height: number };
    phase: "opening" | "open" | "closing";
    transform: string;
    flipped: boolean;
  };

  const computeDetailsTransform = useCallback(
    (origin: { top: number; left: number; width: number; height: number }) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const baseWidth = CARD_WIDTH + GAP;
      const baseHeight = CARD_HEIGHT + GAP;
      const ratio = baseWidth / baseHeight;

      // Keep some padding from the screen edges when expanded.
      // Use a larger vertical pad so the expanded card doesn't stick to 100% height.
      const viewportPadX = 24;
      const viewportPadY = 56;
      const availW = Math.max(0, vw - viewportPadX * 2);
      const availH = Math.max(0, vh - viewportPadY * 2);

      // Maximize within the padded viewport, preserving card aspect ratio.
      const targetHeight = Math.min(availH, availW / ratio);
      const targetWidth = targetHeight * ratio;

      const targetLeft = (vw - targetWidth) / 2;
      // Keep the expanded card aligned to the top padding.
      const targetTop = viewportPadY;

      const scaleX = targetWidth / origin.width;
      const scaleY = targetHeight / origin.height;
      const scale = Math.min(scaleX, scaleY);

      const dx = targetLeft - origin.left;
      const dy = targetTop - origin.top;

      return {
        transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`,
      };
    },
    []
  );

  const [pokemonDetails, setPokemonDetails] =
    useState<PokemonDetailsState | null>(null);

  const detailBackCardRef = useRef<HTMLDivElement | null>(null);

  const openPokemonDetails = useCallback(
    (pokemon: any, originEl: HTMLElement) => {
      const r = originEl.getBoundingClientRect();
      const origin = {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      };

      setPokemonDetails({
        pokemon,
        origin,
        phase: "opening",
        transform: "translate3d(0px, 0px, 0) scale(1)",
        flipped: false,
      });
    },
    []
  );

  const closePokemonDetails = useCallback(() => {
    setPokemonDetails((s) =>
      s
        ? {
            ...s,
            phase: "closing",
            transform: "translate3d(0px, 0px, 0) scale(1)",
            flipped: false,
          }
        : s
    );
  }, []);

  useEffect(() => {
    if (!pokemonDetails) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [pokemonDetails]);

  useEffect(() => {
    if (!pokemonDetails || pokemonDetails.phase !== "opening") return;

    const id = requestAnimationFrame(() => {
      setPokemonDetails((s) => {
        if (!s || s.phase !== "opening") return s;
        const { transform } = computeDetailsTransform(s.origin);
        return { ...s, phase: "open", transform, flipped: true };
      });
    });

    return () => cancelAnimationFrame(id);
  }, [pokemonDetails, computeDetailsTransform]);

  useEffect(() => {
    if (!pokemonDetails || pokemonDetails.phase === "closing") return;

    const onResize = () => {
      setPokemonDetails((s) => {
        if (!s || s.phase === "closing") return s;
        const { transform } = computeDetailsTransform(s.origin);
        return { ...s, transform };
      });
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pokemonDetails, computeDetailsTransform]);

  const [pvpCategories, setPvpCategories] = useState<string[]>(["overall"]);
  const [bestTeamsEnabled, setBestTeamsEnabled] = useState(false);
  const [containerDimensions, setContainerDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight - 80,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const userId = getUserId();

  const loadUserFiles = useCallback(async () => {
    try {
      const response = await apiClient.getUserFiles(userId);
      setUserFiles(response.files || []);
    } catch (error) {
      console.error("Error loading user files:", error);
      setUserFiles([]);
    }
  }, [userId]);

  useEffect(() => {
    loadUserFiles();
  }, [loadUserFiles]);

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

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Poll progress during upload (only used on the /dex "empty" state)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!uploadFileId || !uploading) return;

    const interval = setInterval(async () => {
      try {
        const prog = await apiClient.getProgress(uploadFileId);
        setProgress(prog);

        if (prog.status === "completed") {
          setUploading(false);
          setProgress(null);
          setCurrentUploadName(null);

          // Refresh select list and open the newly uploaded file.
          await loadUserFiles();
          message.success("File enriched successfully!");
          navigate(`/dex/${uploadFileId}`);
          setUploadFileId(null);
        }
      } catch (error) {
        console.error("Error polling progress:", error);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [uploadFileId, uploading, navigate, loadUserFiles]);

  // Process Snorlax drop uploads sequentially (queue)
  useEffect(() => {
    if (uploading) return;
    if (uploadFileId) return;
    if (uploadQueue.length === 0) return;

    const next = uploadQueue[0];
    setUploadQueue((q) => q.slice(1));
    void uploadFile(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadQueue, uploading, uploadFileId]);

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const res = await apiClient.getPvpCategories();
        const cats = (res?.categories || []).map((c: any) =>
          String(c).toLowerCase()
        );
        const normalized = Array.from(new Set(["overall", ...cats]));
        setPvpCategories(normalized);

        const selected = (pvpCategory || "overall").toLowerCase();
        if (!normalized.includes(selected)) {
          setPvpCategory("overall");
        }
      } catch {
        setPvpCategories(["overall"]);
        setPvpCategory("overall");
      }
    };

    if (pvpEnabled) {
      loadCategories();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvpEnabled]);

  const handlePvpToggle = (checked: boolean) => {
    setPvpEnabled(checked);
    if (checked) {
      setUniqueOnly(false);
    }
    if (!checked) {
      setBestTeamsEnabled(false);
    }
  };

  const handleUniqueToggle = (checked: boolean) => {
    setUniqueOnly(checked);
    if (checked) {
      setPvpEnabled(false);
      setBestTeamsEnabled(false);
    }
  };

  const loadFileData = async () => {
    if (!fileId) {
      setFileData(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await apiClient.getFileData(userId, fileId, {
        search: debouncedSearch,
        order_by: orderBy,
        order_dir: orderDir,
        unique: uniqueOnly,
        pvp: pvpEnabled,
        league: pvpLeague,
        category: pvpCategory,
        best_teams: bestTeamsEnabled,
      });
      setFileData(data);
    } catch (error) {
      try {
        const data = await apiClient.getPublicFileData(fileId, {
          search: debouncedSearch,
          order_by: orderBy,
          order_dir: orderDir,
          unique: uniqueOnly,
          pvp: pvpEnabled,
          league: pvpLeague,
          category: pvpCategory,
          best_teams: bestTeamsEnabled,
        });
        setFileData(data);
      } catch (error2) {
        console.error("Error loading file data:", error);
        console.error("Error loading public file data:", error2);
        setFileData(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFileData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fileId,
    debouncedSearch,
    orderBy,
    orderDir,
    uniqueOnly,
    pvpEnabled,
    pvpLeague,
    pvpCategory,
    bestTeamsEnabled,
  ]);

  const getFileDisplayName = useCallback((file: UserFile) => {
    let displayName = file.filename.replace(".json", "");

    if (file.user && file.date) {
      const date = new Date(file.date);
      const formattedDate = date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      displayName = `${file.user} - ${formattedDate}`;
    }

    return displayName;
  }, []);

  const fileSelectOptions = useMemo(() => {
    const sorted = [...userFiles].sort((a, b) => {
      const au = (a.user || "").toString().toLowerCase();
      const bu = (b.user || "").toString().toLowerCase();

      // Primary: user name alphabetical
      const userCmp = au.localeCompare(bu, "pt-BR", { sensitivity: "base" });
      if (userCmp !== 0) return userCmp;

      // Secondary: date desc when available
      const ad = a.date ? Date.parse(a.date) : 0;
      const bd = b.date ? Date.parse(b.date) : 0;
      if (ad !== bd) return bd - ad;

      // Fallback: filename
      return (a.filename || "").localeCompare(b.filename || "", "pt-BR", {
        sensitivity: "base",
      });
    });

    const opts = sorted.map((file) => ({
      value: file.file_id,
      label: getFileDisplayName(file),
    }));

    // If we opened a public/shared link, show it in the Select even if it's not part of the user's list.
    if (fileId && fileData?.metadata?.filename) {
      const exists = opts.some((o) => o.value === fileId);
      if (!exists) {
        const base = String(fileData.metadata.filename).replace(/\.json$/i, "");
        opts.unshift({ value: fileId, label: `${base} (shared)` });
      }
    }

    return opts;
  }, [userFiles, getFileDisplayName, fileId, fileData]);

  const canDeleteSelectedFile = useMemo(() => {
    if (!fileId) return false;
    // Only allow delete if it's one of the user's own files (not a shared/public one).
    return userFiles.some((f) => f.file_id === fileId);
  }, [fileId, userFiles]);

  const handleDeleteSelectedFile = useCallback(async () => {
    if (!fileId) return;
    if (!canDeleteSelectedFile) return;

    const file = userFiles.find((f) => f.file_id === fileId);
    const display = file ? getFileDisplayName(file) : fileId;

    try {
      await apiClient.deleteFile(userId, fileId);
      message.success(`Deleted: ${display}`);
      await loadUserFiles();
      navigate("/dex");
      setFileData(null);
    } catch (error: any) {
      message.error(`Failed to delete: ${error?.message || "unknown error"}`);
    }
  }, [
    fileId,
    canDeleteSelectedFile,
    userFiles,
    getFileDisplayName,
    userId,
    loadUserFiles,
    navigate,
  ]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
    setSnorlaxOpen(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setSnorlaxOpen(false);
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      try {
        setUploading(true);
        setCurrentUploadName(file.name);
        setProgress({ current: 0, total: 100, status: "uploading" });

        const response = await apiClient.uploadFile("/api/upload", file, {
          user_id: userId,
        });

        message.success(`Uploaded: ${response.filename}`);

        // Refresh the select list immediately so the new JSON appears.
        await loadUserFiles();

        setUploadFileId(response.file_id);
        setProgress({
          current: 0,
          total: response.total_pokemon,
          status: "processing",
        });
      } catch (error: any) {
        message.error(`Upload failed: ${error.message}`);
        setUploading(false);
        setProgress(null);
        setUploadFileId(null);
        setCurrentUploadName(null);
      }
    },
    [loadUserFiles, userId]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      setSnorlaxOpen(false);

      const dropped = Array.from(e.dataTransfer.files || []);
      if (dropped.length === 0) {
        message.error("No file was dropped!");
        return;
      }

      const jsonFiles = dropped.filter((f) => f.name.endsWith(".json"));
      const skipped = dropped.length - jsonFiles.length;

      if (jsonFiles.length === 0) {
        message.error("Please upload JSON files!");
        return;
      }

      if (skipped > 0) {
        message.warning(`Skipped ${skipped} non-JSON file(s)`);
      }

      setUploadQueue((q) => [...q, ...jsonFiles]);
      message.success(`Queued ${jsonFiles.length} file(s)`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId]
  );

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  const handleSortChange = (value: string) => {
    const [field, direction] = value.split("-");
    setOrderBy(field);
    setOrderDir(direction);
  };

  // used only for UI messaging in the Snorlax dropzone
  void currentUploadName;

  // Calculate tallest height per species for proportional image sizing
  const speciesTallestByDex = useMemo(() => {
    if (!fileData) return {};
    const map: Record<number, number> = {};
    const allPokemon: any[] = [];
    if (Array.isArray(fileData.pokemon)) allPokemon.push(...fileData.pokemon);
    if (Array.isArray(fileData.teams)) {
      for (const t of fileData.teams) {
        for (const m of t?.members || []) allPokemon.push(m);
      }
    }

    for (const pk of allPokemon) {
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
      const isDynamax = Boolean(pokemon.dynamax);
      const isGigantamax = Boolean(pokemon.gigantamax);

      const pokeballMeta = getPokeballMeta(pokemon);

      const pvpActive = Boolean(pvpEnabled && pokemon.pvp_enabled);
      const pvpAtk = pokemon.pvp_meta_atk;
      const pvpDef = pokemon.pvp_meta_def;
      const pvpStm = pokemon.pvp_meta_stm;
      const pvpCp = pokemon.pvp_meta_cp;

      const atkMatch =
        pvpActive &&
        pvpAtk !== undefined &&
        Number(pokemon.attack) === Number(pvpAtk);
      const defMatch =
        pvpActive &&
        pvpDef !== undefined &&
        Number(pokemon.defence) === Number(pvpDef);
      const stmMatch =
        pvpActive &&
        pvpStm !== undefined &&
        Number(pokemon.stamina) === Number(pvpStm);

      const statColor = (match: boolean) => (match ? "#52c41a" : "#ff4d4f");
      const cpMatch =
        pvpActive &&
        pvpCp !== undefined &&
        Number(pokemon.cp) === Number(pvpCp);

      // Map lowercase types to uppercase format expected by TYPE_COLORS
      const types = (pokemon.types || []).map(
        (type: string) => `POKEMON_TYPE_${type.toUpperCase()}`
      );
      const typeGradient = getTypeGradient(types);
      const typeBorder = getTypeBorderColor(types);
      const bgImage = getCardBackgroundImage(pokemon);

      return (
        <div
          style={{
            ...style,
            padding: `${GAP / 2}px`,
            boxSizing: "border-box",
          }}
          onClick={(e) =>
            openPokemonDetails(pokemon, e.currentTarget as HTMLElement)
          }
        >
          <div
            className="pokemon-card-wrapper"
            style={{
              position: "relative",
              height: "100%",
              overflow: "visible",
            }}
          >
            {pokeballMeta && (
              <img
                src={pokeballMeta.url}
                alt={pokeballMeta.label}
                title={pokeballMeta.label}
                className="pokeball-overlay"
                style={{
                  position: "absolute",
                  top: -10,
                  right: -10,
                  width: 26,
                  height: 26,
                  objectFit: "contain",
                  zIndex: 60,
                  pointerEvents: "none",
                  filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.7))",
                }}
              />
            )}

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
              {/* Type background image (top -> fade out) */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: "65%",
                  backgroundImage: bgImage,
                  backgroundSize: "cover",
                  backgroundPosition: "top center",
                  opacity: 1,
                  filter: "brightness(1.1) saturate(1.12)",
                  pointerEvents: "none",
                  zIndex: 0,
                  WebkitMaskImage:
                    "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,0) 100%)",
                  maskImage:
                    "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,0) 100%)",
                }}
              />

              {/* Dark overlay for better text readability */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background:
                    "linear-gradient(to bottom, rgba(0,0,0,0.03) 0%, rgba(0,0,0,0.20) 100%)",
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
                      {pvpActive && pvpAtk !== undefined ? (
                        <>
                          <span style={{ color: statColor(atkMatch) }}>
                            {pokemon.attack}
                          </span>
                          <span style={{ color: "#FFFFFF" }}> / </span>
                          <span style={{ color: "#52c41a" }}>{pvpAtk}</span>
                        </>
                      ) : (
                        <span
                          style={{ color: getIvGradientColor(pokemon.attack) }}
                        >
                          {pokemon.attack}
                        </span>
                      )}
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
                        filter:
                          "drop-shadow(0 2px 4px rgba(250, 173, 20, 0.8))",
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
                      {pvpActive && pvpDef !== undefined ? (
                        <>
                          <span style={{ color: statColor(defMatch) }}>
                            {pokemon.defence}
                          </span>
                          <span style={{ color: "#FFFFFF" }}> / </span>
                          <span style={{ color: "#52c41a" }}>{pvpDef}</span>
                        </>
                      ) : (
                        <span
                          style={{ color: getIvGradientColor(pokemon.defence) }}
                        >
                          {pokemon.defence}
                        </span>
                      )}
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
                        filter:
                          "drop-shadow(0 2px 4px rgba(235, 47, 150, 0.8))",
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
                      {pvpActive && pvpStm !== undefined ? (
                        <>
                          <span style={{ color: statColor(stmMatch) }}>
                            {pokemon.stamina}
                          </span>
                          <span style={{ color: "#FFFFFF" }}> / </span>
                          <span style={{ color: "#52c41a" }}>{pvpStm}</span>
                        </>
                      ) : (
                        <span
                          style={{ color: getIvGradientColor(pokemon.stamina) }}
                        >
                          {pokemon.stamina}
                        </span>
                      )}
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
                    zIndex: 30,
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

                  {isGigantamax ? (
                    <img
                      src="/img/icons/gigantamax.png"
                      alt="gigantamax"
                      title="Gigantamax"
                      style={{
                        width: 22,
                        height: 22,
                        objectFit: "contain",
                        filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.9))",
                      }}
                    />
                  ) : isDynamax ? (
                    <img
                      src="/img/icons/dynamax.png"
                      alt="dynamax"
                      title="Dynamax"
                      style={{
                        width: 22,
                        height: 22,
                        objectFit: "contain",
                        filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.9))",
                      }}
                    />
                  ) : null}
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
                    zIndex: 10,
                  }}
                >
                  <PokemonImage
                    staticSrc={
                      pokemon.image
                        ? `/${pokemon.image}`
                        : "/img/placeholder.png"
                    }
                    alt={pokemon.name}
                    className={[
                      isApex
                        ? "pokemon-apex"
                        : isShiny
                        ? "pokemon-shiny"
                        : isShadow
                        ? "pokemon-shadow"
                        : isPurified
                        ? "pokemon-purified"
                        : "",
                      isGigantamax || isDynamax ? "pokemon-dynamax" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    pokemonHeight={pokemon.height || 1}
                    tallestHeight={
                      speciesTallestByDex[pokemon.number] || pokemon.height || 1
                    }
                    containerWidth={CARD_WIDTH}
                    containerHeight={120}
                    minPx={60}
                    heightMultiplier={isGigantamax ? 1.2 : 1}
                  />
                </div>

                {/* Pokemon Info */}
                <div
                  style={{
                    textAlign: "center",
                    position: "relative",
                    zIndex: 2,
                  }}
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
                      {pokemon.gender_symbol &&
                        pokemon.gender_symbol !== "⚲" && (
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
                      {pvpActive && pvpCp !== undefined ? (
                        <>
                          <span style={{ color: "#FFFFFF" }}>CP </span>
                          <span style={{ color: statColor(cpMatch) }}>
                            {pokemon.cp}
                          </span>
                          <span style={{ color: "#FFFFFF" }}> / </span>
                          <span style={{ color: "#52c41a" }}>{pvpCp}</span>
                        </>
                      ) : (
                        `CP ${pokemon.cp}`
                      )}
                    </Tag>

                    {pvpEnabled && pokemon.pvp_meta_rank !== undefined && (
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
                        #{pokemon.pvp_meta_rank}
                      </Tag>
                    )}
                    {!pvpActive &&
                      (pokemon.height_label || pokemon.weight_label) && (
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
        </div>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fileData, columnsCount]
  );

  const renderPokemonCardStandalone = useCallback(
    (pokemon: any, opts?: { enableDetailsClick?: boolean }) => {
      const enableDetailsClick = opts?.enableDetailsClick !== false;
      const isShiny = pokemon.shiny || false;
      const isShadow = pokemon.shadow || false;
      const isLucky = pokemon.lucky || false;
      const isPurified = pokemon.purified || false;
      const isApex = pokemon.apex || false;
      const isDynamax = Boolean(pokemon.dynamax);
      const isGigantamax = Boolean(pokemon.gigantamax);

      const pokeballMeta = getPokeballMeta(pokemon);

      const pvpActive = Boolean(pokemon.pvp_enabled);
      const pvpAtk = pokemon.pvp_meta_atk;
      const pvpDef = pokemon.pvp_meta_def;
      const pvpStm = pokemon.pvp_meta_stm;
      const pvpCp = pokemon.pvp_meta_cp;

      const atkMatch =
        pvpActive &&
        pvpAtk !== undefined &&
        Number(pokemon.attack) === Number(pvpAtk);
      const defMatch =
        pvpActive &&
        pvpDef !== undefined &&
        Number(pokemon.defence) === Number(pvpDef);
      const stmMatch =
        pvpActive &&
        pvpStm !== undefined &&
        Number(pokemon.stamina) === Number(pvpStm);

      const statColor = (match: boolean) => (match ? "#52c41a" : "#ff4d4f");
      const cpMatch =
        pvpActive &&
        pvpCp !== undefined &&
        Number(pokemon.cp) === Number(pvpCp);

      const types = (pokemon.types || []).map(
        (type: string) => `POKEMON_TYPE_${type.toUpperCase()}`
      );
      const typeGradient = getTypeGradient(types);
      const typeBorder = getTypeBorderColor(types);
      const bgImage = getCardBackgroundImage(pokemon);

      return (
        <div
          style={{
            width: CARD_WIDTH + GAP,
            height: CARD_HEIGHT + GAP,
            padding: `${GAP / 2}px`,
            boxSizing: "border-box",
          }}
          onClick={
            enableDetailsClick
              ? (e) =>
                  openPokemonDetails(pokemon, e.currentTarget as HTMLElement)
              : undefined
          }
        >
          <div
            className="pokemon-card-wrapper"
            style={{
              position: "relative",
              height: "100%",
              overflow: "visible",
            }}
          >
            {pokeballMeta && (
              <img
                src={pokeballMeta.url}
                alt={pokeballMeta.label}
                title={pokeballMeta.label}
                className="pokeball-overlay"
                style={{
                  position: "absolute",
                  top: -10,
                  right: -10,
                  width: 26,
                  height: 26,
                  objectFit: "contain",
                  zIndex: 60,
                  pointerEvents: "none",
                  filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.7))",
                }}
              />
            )}

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
              {/* Type background image (top -> fade out) */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: "65%",
                  backgroundImage: bgImage,
                  backgroundSize: "cover",
                  backgroundPosition: "top center",
                  opacity: 1,
                  filter: "brightness(1.1) saturate(1.12)",
                  pointerEvents: "none",
                  zIndex: 0,
                  WebkitMaskImage:
                    "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,0) 100%)",
                  maskImage:
                    "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,0) 100%)",
                }}
              />

              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background:
                    "linear-gradient(to bottom, rgba(0,0,0,0.03) 0%, rgba(0,0,0,0.20) 100%)",
                  pointerEvents: "none",
                  zIndex: 1,
                }}
              />

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
                        textShadow:
                          "0 2px 6px rgba(0,0,0,1), 0 0 8px rgba(255, 77, 79, 0.5)",
                      }}
                    >
                      {pvpActive && pvpAtk !== undefined ? (
                        <>
                          <span style={{ color: statColor(atkMatch) }}>
                            {pokemon.attack}
                          </span>
                          <span style={{ color: "#FFFFFF" }}> / </span>
                          <span style={{ color: "#52c41a" }}>{pvpAtk}</span>
                        </>
                      ) : (
                        <span
                          style={{ color: getIvGradientColor(pokemon.attack) }}
                        >
                          {pokemon.attack}
                        </span>
                      )}
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
                        filter:
                          "drop-shadow(0 2px 4px rgba(250, 173, 20, 0.8))",
                      }}
                    />
                    <span
                      style={{
                        fontSize: "15px",
                        fontWeight: "800",
                        textShadow:
                          "0 2px 6px rgba(0,0,0,1), 0 0 8px rgba(250, 173, 20, 0.5)",
                      }}
                    >
                      {pvpActive && pvpDef !== undefined ? (
                        <>
                          <span style={{ color: statColor(defMatch) }}>
                            {pokemon.defence}
                          </span>
                          <span style={{ color: "#FFFFFF" }}> / </span>
                          <span style={{ color: "#52c41a" }}>{pvpDef}</span>
                        </>
                      ) : (
                        <span
                          style={{ color: getIvGradientColor(pokemon.defence) }}
                        >
                          {pokemon.defence}
                        </span>
                      )}
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
                        filter:
                          "drop-shadow(0 2px 4px rgba(235, 47, 150, 0.8))",
                      }}
                    />
                    <span
                      style={{
                        fontSize: "15px",
                        fontWeight: "800",
                        textShadow:
                          "0 2px 6px rgba(0,0,0,1), 0 0 8px rgba(235, 47, 150, 0.5)",
                      }}
                    >
                      {pvpActive && pvpStm !== undefined ? (
                        <>
                          <span style={{ color: statColor(stmMatch) }}>
                            {pokemon.stamina}
                          </span>
                          <span style={{ color: "#FFFFFF" }}> / </span>
                          <span style={{ color: "#52c41a" }}>{pvpStm}</span>
                        </>
                      ) : (
                        <span
                          style={{ color: getIvGradientColor(pokemon.stamina) }}
                        >
                          {pokemon.stamina}
                        </span>
                      )}
                    </span>
                  </div>,
                ]}
              >
                {/* Pokemon Badges (same as normal card) */}
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
                    zIndex: 30,
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

                  {isGigantamax ? (
                    <img
                      src="/img/icons/gigantamax.png"
                      alt="gigantamax"
                      title="Gigantamax"
                      style={{
                        width: 22,
                        height: 22,
                        objectFit: "contain",
                        filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.9))",
                      }}
                    />
                  ) : isDynamax ? (
                    <img
                      src="/img/icons/dynamax.png"
                      alt="dynamax"
                      title="Dynamax"
                      style={{
                        width: 22,
                        height: 22,
                        objectFit: "contain",
                        filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.9))",
                      }}
                    />
                  ) : null}
                </div>

                <div
                  style={{
                    width: "100%",
                    height: "120px",
                    display: "flex",
                    alignItems: "end",
                    justifyContent: "center",
                    marginBottom: "12px",
                    position: "relative",
                    zIndex: 10,
                  }}
                >
                  <PokemonImage
                    staticSrc={
                      pokemon.image
                        ? `/${pokemon.image}`
                        : "/img/placeholder.png"
                    }
                    alt={pokemon.name}
                    className={[
                      isApex
                        ? "pokemon-apex"
                        : isShiny
                        ? "pokemon-shiny"
                        : isShadow
                        ? "pokemon-shadow"
                        : isPurified
                        ? "pokemon-purified"
                        : "",
                      isGigantamax || isDynamax ? "pokemon-dynamax" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    pokemonHeight={pokemon.height || 1}
                    tallestHeight={
                      speciesTallestByDex[pokemon.number] || pokemon.height || 1
                    }
                    containerWidth={CARD_WIDTH}
                    containerHeight={120}
                    minPx={60}
                    heightMultiplier={isGigantamax ? 1.2 : 1}
                  />
                </div>

                <div
                  style={{
                    textAlign: "center",
                    position: "relative",
                    zIndex: 2,
                  }}
                >
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
                      {pokemon.gender_symbol &&
                        pokemon.gender_symbol !== "⚲" && (
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
                      {pvpActive && pvpCp !== undefined ? (
                        <>
                          <span style={{ color: "#FFFFFF" }}>CP </span>
                          <span style={{ color: statColor(cpMatch) }}>
                            {pokemon.cp}
                          </span>
                          <span style={{ color: "#FFFFFF" }}> / </span>
                          <span style={{ color: "#52c41a" }}>{pvpCp}</span>
                        </>
                      ) : (
                        `CP ${pokemon.cp}`
                      )}
                    </Tag>

                    {pokemon.pvp_enabled &&
                      pokemon.pvp_meta_rank !== undefined && (
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
                          #{pokemon.pvp_meta_rank}
                        </Tag>
                      )}
                    {!pvpActive &&
                      (pokemon.height_label || pokemon.weight_label) && (
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
        </div>
      );
    },
    [openPokemonDetails, speciesTallestByDex]
  );

  const renderTeamSummaryCards = useCallback((team: any) => {
    const strengths = team?.summary?.strengths || [];
    const weaknesses = team?.summary?.weaknesses || [];

    const renderOne = (
      title: "Strong" | "Weak",
      items: Array<{ id: string; name: string }>
    ) => (
      <div
        style={{
          width: CARD_WIDTH + GAP,
          height: CARD_HEIGHT + GAP,
          padding: `${GAP / 2}px`,
          boxSizing: "border-box",
        }}
      >
        <div
          className="pokemon-card"
          style={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background:
              title === "Strong"
                ? "linear-gradient(145deg, #1f3a2a, #2d4a2e)"
                : "linear-gradient(145deg, #3a1f1f, #4a2e2e)",
            borderColor: title === "Strong" ? "#4a7c4d" : "#7c4a4a",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background:
                title === "Strong"
                  ? "linear-gradient(to bottom, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.40) 100%), radial-gradient(circle at 20% 10%, rgba(136, 204, 136, 0.12), transparent 55%)"
                  : "linear-gradient(to bottom, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.40) 100%), radial-gradient(circle at 20% 10%, rgba(204, 136, 136, 0.12), transparent 55%)",
              pointerEvents: "none",
              zIndex: 1,
            }}
          />

          <Card
            variant="outlined"
            style={{
              background: "transparent",
              height: "100%",
              display: "flex",
              flexDirection: "column",
            }}
            styles={{
              body: {
                padding: "12px",
                flex: 1,
                display: "flex",
                flexDirection: "column",
              },
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                zIndex: 2,
              }}
            >
              {/* Title using the same badge strip container as normal cards */}
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div
                  style={{
                    display: "inline-flex",
                    gap: "8px",
                    justifyContent: "center",
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
                  <span
                    style={{
                      fontWeight: "800",
                      fontSize: "14px",
                      color: "#ffffff",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {title}
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {items.length ? (
                  items.map((it: any) => (
                    <Tag
                      key={it.id}
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
                      {it.name}
                    </Tag>
                  ))
                ) : (
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
                    —
                  </Tag>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    );

    return (
      <>
        {renderOne("Strong", strengths)}
        {renderOne("Weak", weaknesses)}
      </>
    );
  }, []);
  return (
    <div style={{ minHeight: "100vh", paddingTop: "80px" }}>
      {pokemonDetails && (
        <div
          className="pokemon-detail-overlay"
          onClick={closePokemonDetails}
          role="presentation"
        >
          <div
            className="pokemon-detail-anim"
            style={{
              top: pokemonDetails.origin.top,
              left: pokemonDetails.origin.left,
              transform: pokemonDetails.transform,
            }}
            onClick={(e) => e.stopPropagation()}
            onTransitionEnd={(e) => {
              if (e.propertyName !== "transform") return;
              setPokemonDetails((s) => (s?.phase === "closing" ? null : s));
            }}
          >
            <div
              className="pokemon-detail-scene"
              style={{
                width: CARD_WIDTH + GAP,
                height: CARD_HEIGHT + GAP,
              }}
            >
              <div
                className={
                  pokemonDetails.flipped
                    ? "pokemon-detail-inner is-flipped"
                    : "pokemon-detail-inner"
                }
              >
                <div className="pokemon-detail-face pokemon-detail-front">
                  {renderPokemonCardStandalone(pokemonDetails.pokemon, {
                    enableDetailsClick: false,
                  })}
                </div>

                <div className="pokemon-detail-face pokemon-detail-back">
                  {/* Blank card back (empty, ready for future details UI) */}
                  <div className="pokemon-detail-blank-wrap">
                    <div
                      className="pokemon-detail-blank-card"
                      ref={detailBackCardRef}
                      style={{
                        ["--detail-bg-image" as any]: getCardBackgroundImage(
                          pokemonDetails.pokemon
                        ),
                      }}
                    >
                      {(() => {
                        const cp = Number(pokemonDetails.pokemon?.cp);
                        const maxCp = calcMaxCp(pokemonDetails.pokemon);
                        const ratio =
                          Number.isFinite(cp) && maxCp
                            ? clamp01(cp / maxCp)
                            : 0;

                        // Perfect semicircle: diameter spans the available width.
                        const r = 50;
                        const d = "M 0 50 A 50 50 0 0 1 100 50";
                        const circumference = Math.PI * r;
                        const dash = circumference * ratio;

                        const cx = 50;
                        const cy = 50;
                        // ratio: 0 (left) -> 1 (right)
                        const angle = Math.PI * (1 - ratio);
                        const knobX = cx + r * Math.cos(angle);
                        const knobY = cy - r * Math.sin(angle);

                        return (
                          <div className="pokemon-detail-cp-wrap">
                            <svg
                              className="pokemon-detail-cp-svg"
                              viewBox="-6 -6 112 62"
                              preserveAspectRatio="xMidYMid meet"
                              aria-label="CP progress"
                            >
                              <path
                                d={d}
                                className="pokemon-detail-cp-track"
                                pathLength={circumference}
                              />
                              <path
                                d={d}
                                className="pokemon-detail-cp-progress"
                                pathLength={circumference}
                                style={{
                                  strokeDasharray: `${dash} ${circumference}`,
                                }}
                              />
                              <circle
                                className="pokemon-detail-cp-knob"
                                cx={knobX}
                                cy={knobY}
                                r={1.5}
                              />
                            </svg>
                            <div className="pokemon-detail-cp-text">
                              <span className="pokemon-detail-cp-label">
                                CP
                              </span>
                              <span className="pokemon-detail-cp-value">
                                {Number.isFinite(cp) ? cp : "—"}
                              </span>
                            </div>
                          </div>
                        );
                      })()}

                      <div
                        className="pokemon-detail-back-panel"
                        style={{ top: DETAILS_PANEL_TOP_PX }}
                      >
                        <div className="pokemon-detail-back-panel-inner">
                          {(() => {
                            const staticSrc = pokemonDetails.pokemon?.image
                              ? `/${pokemonDetails.pokemon.image}`
                              : "/img/placeholder.png";

                            const animatedName = String(
                              pokemonDetails.pokemon?.image_animated || ""
                            ).trim();
                            const animatedSrc = animatedName
                              ? `https://s3.us-west-004.backblazeb2.com/pokedeiz/animated/${animatedName}`
                              : "";

                            const isGigantamax = Boolean(
                              pokemonDetails.pokemon?.gigantamax
                            );
                            const className = isGigantamax
                              ? "pokemon-detail-back-sprite is-gigantamax"
                              : "pokemon-detail-back-sprite";

                            const is3d = Boolean(animatedSrc);

                            const imgEl = (
                              <img
                                className={className}
                                src={animatedSrc || staticSrc}
                                alt={pokemonDetails.pokemon?.name || "pokemon"}
                                onError={(e) => {
                                  const img = e.currentTarget;
                                  if (img.dataset.fallbackDone === "1") return;
                                  img.dataset.fallbackDone = "1";
                                  img.src = staticSrc;
                                }}
                              />
                            );

                            const spriteContent = is3d ? (
                              <div
                                className={
                                  isGigantamax
                                    ? "pokemon-detail-back-sprite-holder is-gigantamax"
                                    : "pokemon-detail-back-sprite-holder"
                                }
                              >
                                {imgEl}
                              </div>
                            ) : (
                              imgEl
                            );

                            return (
                              <div className="pokemon-detail-back-sprite-zone">
                                {spriteContent}
                              </div>
                            );
                          })()}

                          <div className="pokemon-detail-back-name">
                            {toTitleCaseName(pokemonDetails.pokemon?.name)}
                          </div>

                          {(() => {
                            const current = Number(
                              pokemonDetails.pokemon?.hp_current ??
                                pokemonDetails.pokemon?.hpCurrent ??
                                pokemonDetails.pokemon?.stamina_current ??
                                pokemonDetails.pokemon?.staminaCurrent
                            );
                            const max = Number(
                              pokemonDetails.pokemon?.hp_max ??
                                pokemonDetails.pokemon?.hpMax ??
                                pokemonDetails.pokemon?.stamina_max ??
                                pokemonDetails.pokemon?.staminaMax
                            );

                            const ratio =
                              Number.isFinite(current) &&
                              Number.isFinite(max) &&
                              max > 0
                                ? clamp01(current / max)
                                : 0;

                            const symbol = String(
                              pokemonDetails.pokemon?.gender_symbol || ""
                            );
                            const showGender = Boolean(
                              symbol && symbol !== "⚲"
                            );

                            return (
                              <div
                                className="pokemon-detail-back-stamina"
                                title={
                                  Number.isFinite(current) &&
                                  Number.isFinite(max) &&
                                  max > 0
                                    ? `Stamina ${current}/${max}`
                                    : "Stamina"
                                }
                              >
                                {pokemonDetails.pokemon?.lucky ? (
                                  <div className="pokemon-detail-back-lucky">
                                    LUCKY POKÉMON
                                  </div>
                                ) : null}

                                <div className="pokemon-detail-back-hp-row">
                                  <div className="pokemon-detail-back-stamina-track">
                                    <div
                                      className="pokemon-detail-back-stamina-fill"
                                      style={{ width: `${ratio * 100}%` }}
                                    />
                                  </div>
                                  {showGender ? (
                                    <div className="pokemon-detail-back-gender">
                                      {symbol}
                                    </div>
                                  ) : null}
                                </div>

                                {Number.isFinite(current) &&
                                Number.isFinite(max) &&
                                max > 0 ? (
                                  <div className="pokemon-detail-back-stamina-text">
                                    {current}/{max} HP
                                  </div>
                                ) : null}
                              </div>
                            );
                          })()}

                          {(() => {
                            const rawWeight = Number(
                              pokemonDetails.pokemon?.weight_kg ??
                                pokemonDetails.pokemon?.weightKg ??
                                pokemonDetails.pokemon?.weight
                            );
                            const rawHeight = Number(
                              pokemonDetails.pokemon?.height_m ??
                                pokemonDetails.pokemon?.heightM ??
                                pokemonDetails.pokemon?.height
                            );

                            const formatValue = (v: number, unit: string) => {
                              if (!Number.isFinite(v)) return "—";
                              const fixed = Math.abs(v - Math.round(v)) < 1e-6;
                              const s = fixed
                                ? String(Math.round(v))
                                : v.toFixed(1);
                              return `${s}${unit}`;
                            };

                            const typesRaw: any[] = Array.isArray(
                              pokemonDetails.pokemon?.types
                            )
                              ? pokemonDetails.pokemon.types
                              : [];
                            const types = Array.from(
                              new Set(
                                typesRaw
                                  .map((t) => String(t || "").trim())
                                  .filter(Boolean)
                                  .map((t) => t.toUpperCase())
                              )
                            );

                            return (
                              <div className="pokemon-detail-back-info-row">
                                <div className="pokemon-detail-back-info-block">
                                  <div className="pokemon-detail-back-info-value">
                                    {formatValue(rawWeight, "KG")}
                                  </div>
                                  <div className="pokemon-detail-back-info-label">
                                    Weight
                                  </div>
                                </div>

                                <div className="pokemon-detail-back-info-sep" />

                                <div className="pokemon-detail-back-info-block">
                                  <div className="pokemon-detail-back-types">
                                    {types.map((t) => (
                                      <img
                                        key={t}
                                        className="pokemon-detail-back-type-icon"
                                        src={`/img/types/POKEMON_TYPE_${t}.png`}
                                        alt={t}
                                      />
                                    ))}
                                  </div>
                                  <div className="pokemon-detail-back-info-label">
                                    {types.length ? types.join(" / ") : "—"}
                                  </div>
                                </div>

                                <div className="pokemon-detail-back-info-sep" />

                                <div className="pokemon-detail-back-info-block">
                                  <div className="pokemon-detail-back-info-value">
                                    {formatValue(rawHeight, "M")}
                                  </div>
                                  <div className="pokemon-detail-back-info-label">
                                    Height
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          {(() => {
                            const isDynamax = Boolean(
                              pokemonDetails.pokemon?.dynamax
                            );
                            const isGigantamax = Boolean(
                              pokemonDetails.pokemon?.gigantamax
                            );
                            if (!isDynamax && !isGigantamax) return null;

                            const parts: string[] = [];
                            if (isGigantamax) parts.push("Gigantamax");
                            else if (isDynamax) parts.push("Dynamax");

                            return (
                              <div className="pokemon-detail-back-max-row">
                                <img
                                  className="pokemon-detail-back-max-icon"
                                  src="/img/icons/dynamax.png"
                                  alt="dynamax"
                                />
                                <div className="pokemon-detail-back-max-text">
                                  {parts.join(" / ")}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <header className="liquid-glass-header">
        {/** When no JSON is selected (/dex), keep controls disabled (except Home + JSON picker). */}
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

        <Select
          className="liquid-glass-select"
          value={fileId || undefined}
          placeholder="Select a JSON"
          allowClear
          options={fileSelectOptions}
          onChange={(value) => {
            if (value) navigate(`/dex/${value}`);
            else navigate("/dex");
          }}
          style={{ minWidth: 240, height: 48 }}
          popupClassName="liquid-glass-select-dropdown"
        />

        <Popconfirm
          title="Delete JSON"
          description="Are you sure you want to delete this JSON?"
          onConfirm={handleDeleteSelectedFile}
          okText="Yes"
          cancelText="No"
          okButtonProps={{
            danger: true,
            style: { background: "#ff4d4f", borderColor: "#ff4d4f" },
          }}
          overlayClassName="liquid-glass-popconfirm"
          disabled={!canDeleteSelectedFile}
        >
          <Button
            icon={<DeleteOutlined />}
            danger
            disabled={!canDeleteSelectedFile}
            style={{
              height: "48px",
              borderRadius: "12px",
              minWidth: "48px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid #ff4d4f",
              color: "#ff4d4f",
              background: "rgba(255, 77, 79, 0.08)",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              if (!canDeleteSelectedFile) return;
              e.currentTarget.style.boxShadow =
                "0 4px 12px rgba(255, 77, 79, 0.25)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = "none";
            }}
          />
        </Popconfirm>

        <input
          type="text"
          className="liquid-glass-input"
          placeholder="Search Pokémon..."
          value={searchQuery}
          onChange={handleSearchChange}
          disabled={!fileId}
          style={{ flex: "1 1 260px", minWidth: "200px" }}
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
            flex: "0 0 auto",
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
          <Switch
            checked={uniqueOnly}
            onChange={handleUniqueToggle}
            disabled={!fileId}
          />
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
            gap: "12px",
            flex: "0 0 auto",
          }}
        >
          <span
            style={{
              color: "#ffffff",
              fontWeight: "500",
              fontSize: "14px",
            }}
          >
            PvP
          </span>
          <Switch
            checked={pvpEnabled}
            onChange={handlePvpToggle}
            disabled={!fileId}
          />
        </div>

        {pvpEnabled && (
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
              flex: "0 0 auto",
            }}
          >
            <span
              style={{
                color: "#ffffff",
                fontWeight: "500",
                fontSize: "14px",
              }}
            >
              BEST TEAMS
            </span>
            <Switch
              checked={bestTeamsEnabled}
              onChange={setBestTeamsEnabled}
              disabled={!fileId}
            />
          </div>
        )}

        {!pvpEnabled && (
          <Select
            className="liquid-glass-select"
            value={`${orderBy}-${orderDir}`}
            onChange={handleSortChange}
            options={SORT_OPTIONS}
            style={{ minWidth: 180, height: 48 }}
            popupClassName="liquid-glass-select-dropdown"
            disabled={!fileId}
          />
        )}

        {pvpEnabled && (
          <Select
            className="liquid-glass-select"
            value={pvpLeague}
            onChange={(value) => setPvpLeague(value as any)}
            options={[
              { value: "GL", label: "Great League" },
              { value: "UL", label: "Ultra League" },
              { value: "ML", label: "Master League" },
            ]}
            style={{ minWidth: 160, height: 48 }}
            popupClassName="liquid-glass-select-dropdown"
            disabled={!fileId}
          />
        )}

        {pvpEnabled && (
          <Select
            className="liquid-glass-select"
            value={pvpCategory}
            onChange={(value) => setPvpCategory(String(value))}
            options={pvpCategories.map((c) => ({ value: c, label: c }))}
            style={{ minWidth: 180, height: 48 }}
            popupClassName="liquid-glass-select-dropdown"
            disabled={!fileId}
          />
        )}

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
            opacity: fileId ? 1 : 0.5,
          }}
        >
          {fileData ? fileData.pokemon.length : 0}{" "}
          {fileData && fileData.pokemon.length > 1 ? "Pokémons" : "Pokémon"}
        </div>
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
        {!fileId ? (
          <div
            style={{
              minHeight: "calc(100vh - 80px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "40px",
            }}
          >
            <div
              className={`liquid-glass-dropzone ${
                isDragOver ? "drag-over" : ""
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{
                width: "600px",
                minHeight: "400px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "40px",
                textAlign: "center",
              }}
            >
              <img
                src={snorlaxOpen ? "/img/open.png" : "/img/closed.png"}
                alt="Snorlax"
                style={{
                  width: "200px",
                  height: "auto",
                  marginBottom: "30px",
                  transition: "all 0.3s ease",
                  filter: "drop-shadow(0 4px 8px rgba(0, 0, 0, 0.5))",
                }}
              />

              <div
                style={{
                  color: "#e0e0e0",
                  fontSize: "20px",
                  fontWeight: "400",
                  textShadow: "0 2px 4px rgba(0, 0, 0, 0.8)",
                  width: "100%",
                }}
              >
                {uploading ? (
                  <>
                    <div
                      style={{
                        fontSize: "24px",
                        fontWeight: "600",
                        marginBottom: "20px",
                        color: "#ffffff",
                      }}
                    >
                      {progress?.status === "uploading"
                        ? "Uploading..."
                        : "Enriching Pokémon..."}
                    </div>
                    <Progress
                      percent={
                        progress
                          ? Math.round(
                              (progress.current / progress.total) * 100
                            )
                          : 0
                      }
                      status="active"
                      strokeColor={{
                        "0%": "#5555ff",
                        "100%": "#8a2be2",
                      }}
                      style={{ marginBottom: "10px" }}
                    />
                    <div style={{ fontSize: "16px", color: "#b0b0c0" }}>
                      {progress?.current} / {progress?.total}
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      style={{
                        fontSize: "24px",
                        fontWeight: "600",
                        marginBottom: "10px",
                        color: "#ffffff",
                      }}
                    >
                      {isDragOver ? "Drop it here!" : "Drop your JSON here"}
                    </div>
                    <div style={{ fontSize: "16px", color: "#b0b0c0" }}>
                      Snorlax is waiting...
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : loading ? (
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
        ) : bestTeamsEnabled &&
          fileData &&
          (fileData.teams || []).length > 0 ? (
          <div
            style={{
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "24px",
            }}
          >
            {(fileData.teams || []).map((t, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "12px",
                  alignItems: "flex-start",
                }}
              >
                {(t.members || []).map((m: any, mi: number) => (
                  <React.Fragment key={`${idx}-${mi}`}>
                    {renderPokemonCardStandalone(m)}
                  </React.Fragment>
                ))}
                {renderTeamSummaryCards(t)}
              </div>
            ))}
          </div>
        ) : bestTeamsEnabled && fileData ? (
          <div
            style={{
              textAlign: "center",
              color: "white",
              fontSize: "18px",
              paddingTop: "100px",
            }}
          >
            No teams found
          </div>
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
