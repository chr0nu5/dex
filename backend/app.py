import json
import os
import re
import unicodedata
import uuid
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# In production (Docker), frontend is in ./build. In dev, it's ../frontend/build
static_folder = "build" if os.path.exists("build") else "../frontend/build"
app = Flask(__name__, static_folder=static_folder)

# Configure CORS - allow all origins
CORS(
    app,
    origins="*",
    methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    supports_credentials=False,
)

# Create necessary directories on startup
REQUIRED_DIRS = ["files", "data", "uploads"]
for dir_name in REQUIRED_DIRS:
    dir_path = os.path.join(os.path.dirname(__file__), dir_name)
    os.makedirs(dir_path, exist_ok=True)
    print(f"✓ Directory '{dir_name}' ready at: {dir_path}")

# Load master data
META_PATH = os.path.join(os.path.dirname(__file__), "data/master.json")
META_MAP = {}

# Integer level CP multipliers (level -> cpm), extracted from master.json
CPM_INT: dict[int, float] = {}


def _extract_cp_multipliers_from_master_text(path: str) -> dict[int, float]:
    """Fallback extractor for cpMultiplier using a streaming text scan.

    Some environments struggle to reliably re-parse or traverse the full master.json.
    This reads the file line-by-line and extracts the numeric cpMultiplier array under
    PLAYER_LEVEL_SETTINGS.
    """
    try:
        import re

        found_settings = False
        in_cpm = False
        values: list[float] = []

        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                if (
                    not found_settings
                    and '"templateId": "PLAYER_LEVEL_SETTINGS"' in line
                ):
                    found_settings = True

                if found_settings and (not in_cpm) and '"cpMultiplier"' in line:
                    in_cpm = True

                if in_cpm:
                    for m in re.findall(r"\b\d+\.\d+\b", line):
                        values.append(float(m))
                    if "]" in line:
                        break

        if not values:
            return {}

        return {i + 1: v for i, v in enumerate(values)}
    except Exception:
        return {}


# Animated images index
ANIMATED_INDEX_PATH = Path("data/3d.txt")


def load_animated_index(path: Path) -> set[str]:
    pool = set()
    if not path.exists():
        return pool
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            name = line.strip()
            if name and name.endswith(".gif"):
                pool.add(name)
    return pool


ANIMATED_INDEX = load_animated_index(ANIMATED_INDEX_PATH)


def _pad3(n):
    try:
        return f"{int(n):03d}"
    except Exception:
        return None


SPECIAL_NAME_ALIASES = {
    "mr mime": "mr._mime",
    "mr. mime": "mr._mime",
    "mime jr": "mime_jr",
    "mime jr.": "mime_jr",
    "type: null": "type-null",
    "farfetch'd": "farfetchd",
    "farfetchd": "farfetchd",
    "sirfetch'd": "sirfetchd",
    "sirfetchd": "sirfetchd",
}


def slugify_species(name: str) -> str:
    """Converte o nome exibido pelo jogo para o pattern usado nos gifs."""
    if not name:
        return ""
    s = name.strip().lower()
    s = "".join(
        c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)
    )
    s_plain = s.replace("'", "'")

    if s_plain in SPECIAL_NAME_ALIASES:
        return SPECIAL_NAME_ALIASES[s_plain]

    base = s_plain.replace(".", "").replace("'", "").replace(" ", "-")
    if base in SPECIAL_NAME_ALIASES:
        return SPECIAL_NAME_ALIASES[base]
    return base


KNOWN_FORM_TOKENS = {
    "alola",
    "galar",
    "gigantamax",
    "gigantamax-nosparks",
    "gigantamax-nosparks-nopowder",
    "zen",
    "lowkey",
    "noice",
    "busted",
    "sunshine",
    "school",
    "fan",
    "frost",
    "heat",
    "mow",
    "wash",
    "crowned",
    "black",
    "white",
    "dawnwings",
    "duskmane",
}


def _is_false_positive_gigantamax_display_form(display_form: str) -> bool:
    """Some exports incorrectly flag isGigantamaxLikely for Zacian/Zamazenta crowned forms."""
    if not display_form or not isinstance(display_form, str):
        return False
    # We intentionally match by suffix/substring to be robust to prefixes.
    return (
        "ZamazentaCrownedShield" in display_form
        or "ZacianCrownedSword" in display_form
        or display_form
        in {
            "PokemonDisplayProto_Form_ZamazentaCrownedShield",
            "PokemonDisplayProto_Form_ZacianCrownedSword",
        }
    )


def _is_false_positive_gigantamax_record(record: dict) -> bool:
    """Exports may incorrectly set isGigantamaxLikely for some records.

    Currently handled:
    - Zacian/Zamazenta crowned forms (via display.form)
    - Eternatus (via pokemon enum)
    """
    if not isinstance(record, dict):
        return False

    # 1) Display-form based suppressions (crowned forms)
    disp = record.get("display")
    if isinstance(disp, dict):
        if _is_false_positive_gigantamax_display_form(str(disp.get("form") or "")):
            return True

    # 2) Species-based suppressions (Eternatus)
    # SpeedUnlocker record uses e.g. "HoloPokemonId_Eternatus".
    pokemon_enum_raw = _strip_known_prefix(
        str(record.get("pokemon") or ""),
        ["HoloPokemonId_", "HoloPokemonId"],
    )
    if _camel_to_upper_snake(pokemon_enum_raw) == "ETERNATUS":
        return True

    # Enriched records store the raw SpeedUnlocker record under "source".
    src = record.get("source")
    if isinstance(src, dict):
        disp2 = src.get("display")
        if isinstance(disp2, dict):
            if _is_false_positive_gigantamax_display_form(str(disp2.get("form") or "")):
                return True
        pokemon_enum_raw2 = _strip_known_prefix(
            str(src.get("pokemon") or ""),
            ["HoloPokemonId_", "HoloPokemonId"],
        )
        if _camel_to_upper_snake(pokemon_enum_raw2) == "ETERNATUS":
            return True

    # Fallback: Eternatus dex number (890)
    try:
        if int(record.get("number") or 0) == 890:
            return True
    except Exception:
        pass

    # Fallback: form token includes ETERNATUS
    try:
        if isinstance(record.get("form"), str) and "ETERNATUS" in record.get(
            "form", ""
        ):
            return True
    except Exception:
        pass

    return False


def _form_tokens_from_record(rec: dict) -> list[str]:
    """Extrai possíveis 'formas' a partir do campo 'form' do seu JSON."""
    form_raw = (rec.get("form") or "").strip().lower()
    if not form_raw:
        return []
    tokens = [t for t in KNOWN_FORM_TOKENS if t in form_raw]
    seen, out = set(), []
    for t in tokens:
        if t not in seen:
            out.append(t)
            seen.add(t)
    return out


def _form_variants_preference(form_tokens: list[str]) -> list[list[str]]:
    """Gera combinações de forma em ordem de preferência."""
    if not form_tokens:
        return [[]]
    ftset = set(form_tokens)
    variants = []
    for g in ["gigantamax-nosparks-nopowder", "gigantamax-nosparks", "gigantamax"]:
        if g in ftset:
            variants.append([g])
    for t in form_tokens:
        if not t.startswith("gigantamax"):
            variants.append([t])
    variants.append([])
    seen, out = set(), []
    for v in variants:
        key = tuple(v)
        if key not in seen:
            out.append(v)
            seen.add(key)
    return out


def load_meta_map():
    global META_MAP
    global CPM_INT
    if not os.path.exists(META_PATH):
        print(f"⚠️  Warning: {META_PATH} not found. Enrichment will be limited.")
        return

    with open(META_PATH, encoding="utf-8") as f:
        raw_data = json.load(f)

    for item in raw_data:
        # Extract CP multipliers once (PLAYER_LEVEL_SETTINGS)
        if item.get("templateId") == "PLAYER_LEVEL_SETTINGS":
            try:
                pls = (
                    item.get("data", {})
                    .get("playerLevelSettings", {})
                    .get("cpMultiplier")
                )
                if isinstance(pls, list) and pls:
                    CPM_INT = {i + 1: float(v) for i, v in enumerate(pls)}
            except Exception:
                pass

        tid = item.get("templateId", "")
        poke = item.get("data", {}).get("pokemonSettings")
        if poke and tid.startswith("V"):
            number = int(tid[1:5])
            form = poke.get("form")
            key = f"{number}_{form}" if form else str(number)

            type_1 = poke.get("type", "").replace("POKEMON_TYPE_", "").lower()
            type_2 = poke.get("type2", "").replace("POKEMON_TYPE_", "").lower()
            pclass = poke.get("pokemonClass")
            family = poke.get("familyId")

            stats = poke.get("stats", {}) or {}
            base_atk = stats.get("baseAttack", 0)
            base_def = stats.get("baseDefense", 0)
            base_sta = stats.get("baseStamina", 0)

            META_MAP[key] = {
                "number": number,
                "name": poke.get("pokemonId"),
                "form": form,
                "types": list(filter(None, [type_1, type_2])),
                "legendary": pclass == "POKEMON_CLASS_LEGENDARY",
                "mythic": pclass == "POKEMON_CLASS_MYTHIC",
                "family": (family or "").replace("FAMILY_", "").lower()
                if family
                else None,
                "pokedex_height": poke.get("pokedexHeightM"),
                "pokedex_weight": poke.get("pokedexWeightKg"),
                "base_atk": base_atk,
                "base_def": base_def,
                "base_sta": base_sta,
            }

    print(f"✓ Loaded {len(META_MAP)} Pokémon from master.json")

    if CPM_INT:
        print(f"✓ Loaded {len(CPM_INT)} CP multipliers from master.json")
    else:
        print("⚠️  Warning: CP multipliers not found in master.json")


load_meta_map()

# Fallback: if CP multipliers were not extracted via JSON traversal, do a streaming
# text-based extraction.
if not CPM_INT and os.path.exists(META_PATH):
    CPM_INT = _extract_cp_multipliers_from_master_text(META_PATH)
    if CPM_INT:
        print(f"✓ Loaded {len(CPM_INT)} CP multipliers (fallback)")
    else:
        print("⚠️  Warning: CP multipliers still unavailable; PVP features disabled")

# -----------------------------
# PVP helpers
# -----------------------------

PVP_LEAGUE_CAPS = {
    "GL": 1500,
    "UL": 2500,
    "ML": 10000,
}

PVP_CATEGORY_DIR = os.path.join(os.path.dirname(__file__), "data", "pvp")


def _list_pvp_categories() -> list[str]:
    try:
        if not os.path.isdir(PVP_CATEGORY_DIR):
            return ["overall"]
        cats = []
        for name in os.listdir(PVP_CATEGORY_DIR):
            if name.startswith("."):
                continue
            p = os.path.join(PVP_CATEGORY_DIR, name)
            if os.path.isdir(p):
                cats.append(name.lower())
        if "overall" not in cats:
            cats.append("overall")
        return sorted(set(cats))
    except Exception:
        return ["overall"]


PVP_CATEGORIES = _list_pvp_categories()


def _pvp_rankings_path(category: str, league: str) -> str:
    # New structure: backend/data/pvp/<category>/rankings-1500.json etc
    cap = PVP_LEAGUE_CAPS.get(league)
    if cap:
        candidate = os.path.join(PVP_CATEGORY_DIR, category, f"rankings-{cap}.json")
        if os.path.exists(candidate):
            return candidate

    # Back-compat fallback: backend/data/rankings-1500.json etc
    if cap:
        legacy = os.path.join(os.path.dirname(__file__), "data", f"rankings-{cap}.json")
        return legacy

    return ""


PVP_RANKINGS_CACHE: dict[tuple[str, str], list[dict]] = {}
PVP_PREFIX_BEST_CACHE: dict[tuple[str, str], dict[str, dict | None]] = {}
PVP_TOP10_IV_CACHE: dict[tuple[int, str | None, str], list[dict]] = {}


def _parse_bool_arg(value: str | None) -> bool:
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "t", "yes", "y", "on"}


def _species_display_name_from_rankings(category: str, league: str) -> dict[str, str]:
    """Build a mapping from speciesId -> display name.

    Rankings JSONs in this repo may or may not include a speciesName field.
    """
    out: dict[str, str] = {}
    for e in _get_pvp_rankings(category, league):
        sid = e.get("speciesId")
        if not sid or not isinstance(sid, str):
            continue
        nm = e.get("speciesName")
        if not nm or not isinstance(nm, str):
            nm = sid.replace("_", " ")
        out.setdefault(sid, nm)
        if sid.endswith("_shadow"):
            base = sid[: -len("_shadow")]
            out.setdefault(base, nm)
    return out


def compute_best_teams(
    pokemon_list: list[dict], league: str, category: str, max_teams: int = 3
) -> list[dict]:
    """Suggest up to max_teams teams of 3 pokemon.

    Heuristic:
    - Candidate pool: dedupe by speciesId keeping the closest-to-meta instance.
    - Consider top-N candidates by meta rank.
    - Score team by (meta strength) - (uncovered shared counters penalty).
    """
    if league not in PVP_LEAGUE_CAPS:
        return []

    cat = (category or "overall").lower()
    if cat not in PVP_CATEGORIES:
        cat = "overall"

    # Only consider pokemon that already have PVP annotations.
    pool = [p for p in pokemon_list if p.get("pvp_enabled") and p.get("pvp_meta_rank")]
    if len(pool) < 3:
        return []

    # Prefer one instance per speciesId.
    by_sid: dict[str, dict] = {}
    for p in pool:
        sid = p.get("pvp_species_id")
        if not sid or not isinstance(sid, str):
            continue
        prev = by_sid.get(sid)
        if prev is None:
            by_sid[sid] = p
            continue

        def _k(x: dict):
            return (
                int(x.get("pvp_distance_sum", 999999) or 999999),
                int(x.get("pvp_distance_max", 999999) or 999999),
                int(x.get("pvp_rank_top10", 999999) or 999999),
                int(x.get("cp", 0) or 0),
            )

        if _k(p) < _k(prev):
            by_sid[sid] = p

    candidates = list(by_sid.values())

    def _rank(p: dict) -> int:
        try:
            return int(p.get("pvp_meta_rank") or 999999)
        except Exception:
            return 999999

    candidates.sort(key=_rank)
    candidates = candidates[:30]
    if len(candidates) < 3:
        return []

    # For display of opponents in summary cards.
    name_map = _species_display_name_from_rankings(cat, league)

    # Thresholds for matchup ratings.
    # Keep strengths somewhat permissive, but require a higher bar to consider a threat "covered"
    # so the Weak list highlights more relevant gaps.
    GOOD_MATCHUP_THRESHOLD = 550
    COVERAGE_THRESHOLD = 550

    def _entry_for(p: dict) -> dict | None:
        pref = p.get("pvp_species_prefix")
        if not pref or not isinstance(pref, str):
            return None
        return best_ranking_entry_for_prefix(cat, league, pref)

    def _build_matchup_map(entry: dict | None) -> dict[str, int]:
        out: dict[str, int] = {}
        if not entry:
            return out
        for m in entry.get("matchups") or []:
            try:
                oid = m.get("opponent")
                if oid and isinstance(oid, str):
                    out[oid] = int(m.get("rating", 0) or 0)
            except Exception:
                continue
        return out

    def _build_counters_map(entry: dict | None) -> dict[str, int]:
        out: dict[str, int] = {}
        if not entry:
            return out
        for m in entry.get("counters") or []:
            try:
                oid = m.get("opponent")
                if oid and isinstance(oid, str):
                    out[oid] = int(m.get("rating", 0) or 0)
            except Exception:
                continue
        return out

    # Precompute maps per candidate
    prepared: list[dict] = []
    for p in candidates:
        entry = _entry_for(p)
        prepared.append(
            {
                "pokemon": p,
                "rank": _rank(p),
                "entry": entry,
                "matchups": _build_matchup_map(entry),
                "counters": _build_counters_map(entry),
            }
        )

    # Generate teams (3-combinations)
    best: list[dict] = []

    def _team_score(team: list[dict]) -> tuple[int, dict]:
        ranks = [t["rank"] for t in team]
        # Higher is better: invert ranks (rank starts at 1)
        meta_score = sum(max(0, 2000 - r) for r in ranks)

        # Threats: union of each member's counters
        threats: dict[str, int] = {}
        for t in team:
            for oid, rating in (t["counters"] or {}).items():
                # Lower rating is worse for us; keep minimum
                threats[oid] = min(threats.get(oid, 999), rating)

        # Coverage: a threat is covered if any member has a strong matchup vs it
        uncovered: dict[str, int] = {}
        for oid, worst_rating in threats.items():
            covered = False
            for t in team:
                if (t["matchups"] or {}).get(oid, 0) >= COVERAGE_THRESHOLD:
                    covered = True
                    break
            if not covered:
                uncovered[oid] = worst_rating

        # Strengths: union of good matchups across members
        strengths: dict[str, int] = {}
        for t in team:
            for oid, rating in (t["matchups"] or {}).items():
                if rating >= GOOD_MATCHUP_THRESHOLD:
                    strengths[oid] = max(strengths.get(oid, 0), rating)

        uncovered_count = len(uncovered)
        score = int(
            meta_score + (len(threats) - uncovered_count) * 10 - uncovered_count * 120
        )

        # Build summary lists
        def _nm(oid: str) -> str:
            if oid in name_map:
                return name_map[oid]
            base = oid.replace("_shadow", "")
            return name_map.get(base, oid.replace("_", " "))

        strengths_list = [
            {"id": oid, "name": _nm(oid), "rating": rt}
            for oid, rt in sorted(strengths.items(), key=lambda kv: -kv[1])[:8]
        ]
        weaknesses_list = [
            {"id": oid, "name": _nm(oid), "rating": rt}
            for oid, rt in sorted(uncovered.items(), key=lambda kv: kv[1])[:8]
        ]

        summary = {
            "score": score,
            "strengths": strengths_list,
            "weaknesses": weaknesses_list,
        }
        return score, summary

    # Brute-force combinations of the candidate list size (<=30)
    n = len(prepared)
    for i in range(n - 2):
        for j in range(i + 1, n - 1):
            for k in range(j + 1, n):
                team = [prepared[i], prepared[j], prepared[k]]
                score, summary = _team_score(team)
                best.append(
                    {
                        "score": score,
                        "members": [
                            team[0]["pokemon"],
                            team[1]["pokemon"],
                            team[2]["pokemon"],
                        ],
                        "summary": summary,
                    }
                )

    best.sort(key=lambda t: -int(t.get("score", 0) or 0))

    # Keep up to max_teams with distinct member sets
    out: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for t in best:
        mem = t.get("members") or []
        sids = []
        for m in mem:
            sid = m.get("pvp_species_id")
            if sid and isinstance(sid, str):
                sids.append(sid)
        if len(sids) != 3:
            continue
        key = tuple(sorted(sids))
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
        if len(out) >= max_teams:
            break

    return out


def _get_pvp_rankings(category: str, league: str) -> list[dict]:
    cat = (category or "overall").lower()
    if cat not in PVP_CATEGORIES:
        cat = "overall"

    key = (cat, league)
    if key in PVP_RANKINGS_CACHE:
        return PVP_RANKINGS_CACHE[key]

    path = _pvp_rankings_path(cat, league)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            data = []
    except Exception:
        data = []

    PVP_RANKINGS_CACHE[key] = data
    return data


def get_cpm(level: float) -> float:
    """Return CP multiplier for integer and half-levels up to 51.

    Half-levels use the common interpolation:
      cpm(L+0.5) = sqrt((cpm(L)^2 + cpm(L+1)^2)/2)
    """
    if not CPM_INT:
        raise RuntimeError("CP multipliers not loaded")

    if float(level).is_integer():
        return CPM_INT.get(int(level), 0.0)

    base = int(level)
    if abs(level - (base + 0.5)) < 1e-9:
        a = CPM_INT.get(base, 0.0)
        b = CPM_INT.get(base + 1, 0.0)
        if not a or not b:
            return 0.0
        return ((a * a + b * b) / 2.0) ** 0.5

    return 0.0


def calc_cp(
    base_atk: int,
    base_def: int,
    base_sta: int,
    iv_atk: int,
    iv_def: int,
    iv_sta: int,
    cpm: float,
) -> int:
    atk = (base_atk + iv_atk) * cpm
    defe = (base_def + iv_def) * cpm
    sta = (base_sta + iv_sta) * cpm
    # CP formula (Pokemon GO):
    #   CP = floor(Atk * sqrt(Def) * sqrt(Sta) / 10)
    # where Atk/Def/Sta are already scaled by the level CP multiplier.
    cp = int((atk * (defe**0.5) * (sta**0.5)) / 10.0)
    return max(10, cp)


def calc_stats(
    base_atk: int,
    base_def: int,
    base_sta: int,
    iv_atk: int,
    iv_def: int,
    iv_sta: int,
    cpm: float,
) -> tuple[float, float, int, float]:
    atk = (base_atk + iv_atk) * cpm
    defe = (base_def + iv_def) * cpm
    hp = int((base_sta + iv_sta) * cpm)
    product = atk * defe * hp
    return atk, defe, hp, product


PVP_LEVELS: list[float] = [x / 2 for x in range(2, 103)]  # 1.0 .. 51.0 step 0.5


def compute_top10_ivs(
    base_atk: int, base_def: int, base_sta: int, cp_cap: int
) -> list[dict]:
    """Compute the top-10 IV spreads for stat product within a CP cap (levels up to 51)."""
    if base_atk <= 0 or base_def <= 0 or base_sta <= 0:
        return []

    results: list[dict] = []

    max_level = 51.0
    max_cpm = get_cpm(max_level)

    for iva in range(16):
        for ivd in range(16):
            for ivs in range(16):
                # Find best (highest) level under cap; product increases with level for fixed IVs.
                level = None

                if (
                    calc_cp(base_atk, base_def, base_sta, iva, ivd, ivs, max_cpm)
                    <= cp_cap
                ):
                    level = max_level
                else:
                    for lv in reversed(PVP_LEVELS):
                        cpm = get_cpm(lv)
                        if not cpm:
                            continue
                        if (
                            calc_cp(base_atk, base_def, base_sta, iva, ivd, ivs, cpm)
                            <= cp_cap
                        ):
                            level = lv
                            break

                if level is None:
                    continue

                cpm = get_cpm(level)
                atk, defe, hp, product = calc_stats(
                    base_atk, base_def, base_sta, iva, ivd, ivs, cpm
                )
                results.append(
                    {
                        "atk_iv": iva,
                        "def_iv": ivd,
                        "stm_iv": ivs,
                        "level": level,
                        "cp": calc_cp(base_atk, base_def, base_sta, iva, ivd, ivs, cpm),
                        "product": product,
                        "atk": atk,
                        "def": defe,
                        "hp": hp,
                    }
                )

    results.sort(
        key=lambda r: (
            -r["product"],
            -r["level"],
            r["atk_iv"],
            -r["def_iv"],
            -r["stm_iv"],
        )
    )
    return results[:10]


def pvp_prefix_candidates(p: dict) -> list[str]:
    form = (p.get("form") or "").upper()
    number = p.get("number")

    # Derive base id from form when possible.
    base = ""
    if form:
        if form.startswith("MR_MIME_"):
            base = "mr_mime"
        elif form.startswith("HO_OH_"):
            base = "ho_oh"
        elif form.startswith("PORYGON_Z_"):
            base = "porygon_z"
        else:
            base = form.split("_")[0].lower()
    else:
        base = slugify_species(str(p.get("name") or "")).replace("-", "_")

    def _normalize_form_suffix_token(tok: str) -> str:
        m = {
            "ALOLA": "alolan",
            "ALOLAN": "alolan",
            "GALAR": "galarian",
            "GALARIAN": "galarian",
            "HISUI": "hisuian",
            "HISUIAN": "hisuian",
            "PALDEA": "paldean",
            "PALDEAN": "paldean",
        }
        return m.get(tok.upper(), tok.lower())

    candidates: list[str] = []

    # 1) Try full-form derived id first (e.g. GIRATINA_ORIGIN -> giratina_origin)
    if form and base and form.startswith(base.upper() + "_"):
        remainder = form[len(base) + 1 :]
        if remainder and remainder != "NORMAL":
            rem_tokens = [t for t in remainder.split("_") if t]
            rem_norm = "_".join(_normalize_form_suffix_token(t) for t in rem_tokens)
            if rem_norm:
                candidates.append(f"{base}_{rem_norm}")

    # 2) Regional shorthand fallback
    if form:
        if "ALOLA" in form:
            candidates.append(f"{base}_alolan")
        if "GALAR" in form:
            candidates.append(f"{base}_galarian")
        if "HISUI" in form:
            candidates.append(f"{base}_hisuian")
        if "PALDEA" in form:
            candidates.append(f"{base}_paldean")

    # 3) Finally, base species id
    candidates.append(base)

    shadow = bool(p.get("shadow"))
    out: list[str] = []
    if shadow:
        for c in candidates:
            out.append(f"{c}_shadow")
    out.extend(candidates)

    # Remove empties and duplicates while preserving order
    seen = set()
    uniq = []
    for c in out:
        if not c:
            continue
        if c not in seen:
            uniq.append(c)
            seen.add(c)
    return uniq


def best_ranking_entry_for_prefix(
    category: str, league: str, prefix: str
) -> dict | None:
    cat = (category or "overall").lower()
    if cat not in PVP_CATEGORIES:
        cat = "overall"

    cache = PVP_PREFIX_BEST_CACHE.setdefault((cat, league), {})
    if prefix in cache:
        return cache[prefix]

    exact_best: tuple[dict, int] | None = None
    boundary_best: tuple[dict, int] | None = None
    prefix_best: tuple[dict, int] | None = None

    for idx, e in enumerate(_get_pvp_rankings(cat, league), start=1):
        sid = e.get("speciesId")
        if not sid or not isinstance(sid, str):
            continue
        rating = int(e.get("rating", 0) or 0)

        if sid == prefix:
            if exact_best is None or rating > int(exact_best[0].get("rating", 0) or 0):
                exact_best = (e, idx)
            continue

        if sid.startswith(prefix + "_"):
            if boundary_best is None or rating > int(
                boundary_best[0].get("rating", 0) or 0
            ):
                boundary_best = (e, idx)
            continue

        if sid.startswith(prefix):
            if prefix_best is None or rating > int(
                prefix_best[0].get("rating", 0) or 0
            ):
                prefix_best = (e, idx)

    chosen = exact_best or boundary_best or prefix_best
    if not chosen:
        cache[prefix] = None
        return None

    entry, rank = chosen
    # Rankings JSON in this repo doesn't provide an explicit "rank" field;
    # we derive it from list order (1-based).
    best = dict(entry)
    best["rank"] = rank
    cache[prefix] = best
    return best


def pvp_match_and_annotate(
    p: dict, league: str, category: str = "overall", threshold: int = 2, top_n: int = 10
) -> bool:
    """Returns True if pokemon matches within threshold of any top-N IV spreads for its species in the league.

    Mutates dict p by adding pvp_* fields when matched.
    """
    if league not in PVP_LEAGUE_CAPS:
        return False

    iva = p.get("attack")
    ivd = p.get("defence")
    ivs = p.get("stamina")
    if iva is None or ivd is None or ivs is None:
        return False

    try:
        iva = int(iva)
        ivd = int(ivd)
        ivs = int(ivs)
    except Exception:
        return False

    base_atk = p.get("base_attack") or p.get("base_atk") or 0
    base_def = p.get("base_defence") or p.get("base_def") or 0
    base_sta = p.get("base_stamina") or p.get("base_sta") or 0
    try:
        base_atk = int(base_atk)
        base_def = int(base_def)
        base_sta = int(base_sta)
    except Exception:
        return False

    prefixes = pvp_prefix_candidates(p)
    best_prefix = None
    best_rank_entry = None
    for pref in prefixes:
        entry = best_ranking_entry_for_prefix(category, league, pref)
        if entry is not None:
            best_prefix = pref
            best_rank_entry = entry
            break

    # If the species isn't present in league rankings, treat it as not eligible.
    if not best_prefix or not best_rank_entry:
        return False

    # League eligibility: in GL/UL you can't use a pokemon above the CP cap.
    # Our IV-matching alone can otherwise include high-CP monsters that *could*
    # be good in theory, but aren't eligible in practice.
    try:
        current_cp = p.get("cp")
        if current_cp is not None:
            current_cp_int = int(current_cp)
            if current_cp_int > int(PVP_LEAGUE_CAPS[league]):
                return False
    except Exception:
        # If CP is missing/unparseable, don't block on it.
        pass

    # Cache key per form+league (base stats depend on form)
    cache_key = (int(p.get("number") or 0), p.get("form"), league)
    if cache_key not in PVP_TOP10_IV_CACHE:
        PVP_TOP10_IV_CACHE[cache_key] = compute_top10_ivs(
            base_atk, base_def, base_sta, PVP_LEAGUE_CAPS[league]
        )

    top = PVP_TOP10_IV_CACHE.get(cache_key, [])[:top_n]
    if not top:
        return False

    best = None
    for idx, cand in enumerate(top, start=1):
        da = iva - cand["atk_iv"]
        dd = ivd - cand["def_iv"]
        ds = ivs - cand["stm_iv"]
        if abs(da) <= threshold and abs(dd) <= threshold and abs(ds) <= threshold:
            score = (max(abs(da), abs(dd), abs(ds)), abs(da) + abs(dd) + abs(ds))
            if best is None or score < best["score"]:
                best = {
                    "rank": idx,
                    "cand": cand,
                    "da": da,
                    "dd": dd,
                    "ds": ds,
                    "score": score,
                }

    if best is None:
        return False

    p["pvp_enabled"] = True
    p["pvp_league"] = league
    p["pvp_rank_top10"] = best["rank"]
    p["pvp_distance_max"] = int(best["score"][0])
    p["pvp_distance_sum"] = int(best["score"][1])
    p["pvp_delta_atk"] = best["da"]
    p["pvp_delta_def"] = best["dd"]
    p["pvp_delta_stm"] = best["ds"]
    p["pvp_meta_atk"] = best["cand"]["atk_iv"]
    p["pvp_meta_def"] = best["cand"]["def_iv"]
    p["pvp_meta_stm"] = best["cand"]["stm_iv"]
    p["pvp_meta_level"] = best["cand"]["level"]
    p["pvp_meta_cp"] = best["cand"]["cp"]
    # Best (rank-1) IV spread for this species under the league cap.
    try:
        best0 = top[0]
        p["pvp_best_atk"] = best0.get("atk_iv")
        p["pvp_best_def"] = best0.get("def_iv")
        p["pvp_best_stm"] = best0.get("stm_iv")
        p["pvp_best_level"] = best0.get("level")
        p["pvp_best_cp"] = best0.get("cp")
    except Exception:
        pass
    p["pvp_species_prefix"] = best_prefix
    p["pvp_species_id"] = best_rank_entry.get("speciesId")
    p["pvp_rating"] = best_rank_entry.get("rating")
    p["pvp_meta_rank"] = best_rank_entry.get("rank")
    p["pvp_category"] = (category or "overall").lower()
    return True


# Storage for enrichment progress
ENRICHMENT_PROGRESS = {}

# Image generation constants
GENDER_VARIANTS = [
    3,
    12,
    19,
    20,
    25,
    26,
    41,
    42,
    44,
    45,
    64,
    65,
    84,
    85,
    97,
    111,
    112,
    118,
    119,
    123,
    129,
    130,
    133,
    154,
    165,
    166,
    178,
    185,
    186,
    190,
    194,
    195,
    198,
    202,
    203,
    207,
    208,
    212,
    214,
    215,
    217,
    221,
    224,
    229,
    232,
    255,
    256,
    257,
    267,
    269,
    272,
    274,
    275,
    307,
    308,
    315,
    316,
    317,
    322,
    323,
    332,
    350,
    369,
    396,
    397,
    398,
    400,
    401,
    402,
    403,
    404,
    405,
    407,
    415,
    417,
    418,
    419,
    424,
    443,
    444,
    445,
    449,
    450,
    453,
    454,
    456,
    457,
    459,
    460,
    461,
    464,
    465,
    473,
    521,
    678,
    876,
    902,
    916,
]

NO_G2_FORMS = ["ALOLA", "PALDEA", "ROCK_STAR", "VS_2019", "POP_STAR"]


def get_image_path(p):
    """Generate image path based on Pokemon attributes"""
    number = p.get("number")
    form = p.get("form")
    costume = p.get("costume")
    gender = p.get("gender", "").upper()
    shiny = p.get("shiny", False)
    height_label = p.get("height_label", "").upper()

    # IMPORTANT:
    # The sprite naming convention is based on the internal pokemonId (e.g., RATTATA)
    # that prefixes the `form` field (e.g., RATTATA_ALOLA), not the human display name
    # (e.g., "Alola Rattata"). Using the display name here breaks form stripping and
    # generates non-existent filenames like `pm19.fRATTATA_ALOLA.icon.png`.
    name = (p.get("name") or "").upper()
    if form:
        # Keep known multi-part pokemonIds intact
        if form.startswith("MR_MIME_"):
            name = "MR_MIME"
        elif form.startswith("HO_OH_"):
            name = "HO_OH"
        elif form.startswith("PORYGON_Z_"):
            name = "PORYGON_Z"
        else:
            name = form.split("_")[0]

    # APEX forms special handling (must return early with shiny if needed)
    if form == "LUGIA_S":
        if shiny:
            return "img/assets/pm249.fS.s.icon.png"
        return "img/assets/pm249.fS.icon.png"
    elif form == "HO_OH_S":
        if shiny:
            return "img/assets/pm250.fS.s.icon.png"
        return "img/assets/pm250.fS.icon.png"

    def _normalize_form_token_for_sprite(token: str) -> str:
        if not token or not isinstance(token, str):
            return token
        # CLONE forms should not include an underscore before the year.
        # Example: COPY_2019 -> COPY2019
        return re.sub(r"\bCOPY_(\d{4})\b", r"COPY\1", token)

    def _is_any_max(pokemon: dict) -> bool:
        if not isinstance(pokemon, dict):
            return False
        if bool(pokemon.get("gigantamax")):
            return True
        # Safety: some legacy/alternate paths might encode Gigantamax only in form.
        try:
            if isinstance(pokemon.get("form"), str) and "GIGANTAMAX" in pokemon.get(
                "form", ""
            ):
                return True
        except Exception:
            pass
        dyn = pokemon.get("dynamax")
        if isinstance(dyn, dict):
            return len(dyn.keys()) > 0
        if isinstance(dyn, bool):
            return dyn
        return False

    image_name = f"pm{number}"
    form_part = form.replace(f"{name}_", "") if form else ""
    form_part = _normalize_form_token_for_sprite(form_part)
    form = _normalize_form_token_for_sprite(form)

    # Special size handling for Pumpkaboo and Gourgeist
    if number in [710, 711]:
        size = height_label if height_label in {"XXS", "XS", "XL", "XXL"} else "AVERAGE"
        image_name += f".f{size}"
    # Porygon-Z (no form suffix needed)
    elif number in [474]:
        pass
    # Mr. Mime and Ho-Oh normal forms - no suffix needed
    elif (number in [122] and form == "MR_MIME_NORMAL") or (
        number in [250] and form == "HO_OH_NORMAL"
    ):
        pass
    # Special names with forms (excluding NORMAL forms)
    elif (
        form
        and name in ["MR_MIME", "HO_OH", "PORYGON_Z"]
        and not form.endswith("_NORMAL")
    ):
        parts = form.split("_")
        if len(parts) >= 3:
            form_part = _normalize_form_token_for_sprite("_".join(parts[2:]))
        image_name += f".f{form_part}"
    # Unown, Burmy, Wormadam - use full form
    elif name in ["UNOWN", "BURMY", "WORMADAM"]:
        image_name += f".f{form}"
    # Kyurem and Genesect with NORMAL form
    elif (name == "KYUREM" or name == "GENESECT") and form and form.endswith("_NORMAL"):
        image_name += ".fNORMAL"
    # Nidoran special cases
    elif (name == "NIDORAN" and form == "NIDORAN_NORMAL") or (
        name == "NIDORINA" and form == "NIDORINA_NORMAL"
    ):
        pass
    # Costume
    elif costume:
        image_name += f".c{costume}"
    # Other forms (not NORMAL)
    elif form and form != f"{name}_NORMAL":
        image_name += f".f{form_part}"

    # Gender variants
    if (
        gender == "FEMALE"
        and number in GENDER_VARIANTS
        and form_part not in NO_G2_FORMS
        and not _is_any_max(p)
    ):
        image_name += ".g2"

    # Shiny
    if shiny:
        image_name += ".s"

    image_name += ".icon.png"
    return f"img/assets/{image_name}"


def get_size_label(pokedex_value, actual_value):
    """Calculate size label based on pokedex and actual values"""
    if not pokedex_value or not actual_value:
        return ""
    if actual_value <= pokedex_value * 0.5:
        return "xxs"
    elif actual_value <= pokedex_value * 0.75:
        return "xs"
    elif actual_value > pokedex_value * 1.5:
        return "xxl"
    elif actual_value > pokedex_value * 1.25:
        return "xl"
    return ""


def extract_metadata_from_filename(filename):
    """Extract logical user and date from export filenames.

    Supported examples:
    - Pokemons-LioAndLiz-18-11-2025.json
    - Pokemons-SpeedUnlocker-JaspionHunter-12-12-2025-15.json

    We intentionally search for the date token anywhere near the end, and treat
    everything between 'Pokemons-' and that date as the logical user.
    """
    if not filename or not isinstance(filename, str):
        return None, None

    stem = filename
    if stem.endswith(".json"):
        stem = stem[: -len(".json")]

    if not stem.startswith("Pokemons-"):
        return None, None

    # Find the last dd-mm-yyyy token in the name.
    m = None
    for m in re.finditer(r"\b(\d{2}-\d{2}-\d{4})\b", stem):
        pass
    if not m:
        return None, None

    date_str = m.group(1)
    user_part = stem[len("Pokemons-") : m.start()].strip("-")
    if not user_part:
        return None, None

    # Tool prefixes we want to ignore for logical user grouping.
    if user_part.startswith("SpeedUnlocker-"):
        user_part = user_part[len("SpeedUnlocker-") :]

    try:
        date_obj = datetime.strptime(date_str, "%d-%m-%Y")
        return user_part, date_obj.isoformat()
    except Exception:
        return None, None


def _camel_to_upper_snake(s: str) -> str:
    if not s or not isinstance(s, str):
        return ""
    s2 = re.sub(r"[^A-Za-z0-9]+", "_", s)
    s2 = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s2)
    s2 = re.sub(r"_+", "_", s2).strip("_")
    return s2.upper()


def _strip_known_prefix(value: str, prefixes: list[str]) -> str:
    if not value or not isinstance(value, str):
        return ""
    out = value
    for p in prefixes:
        if out.startswith(p):
            out = out[len(p) :]
            break
    return out


def _speedunlocker_to_legacy_payload(rec: dict) -> dict:
    """Convert a SpeedUnlocker-style pokemon record into our canonical input schema.

    This keeps enrichment lightweight (we mostly map fields) while enabling our
    existing pipeline (master.json typing, image naming, search helpers).
    """
    if not isinstance(rec, dict):
        return {}

    dex_number = rec.get("dexNumber")
    pokemon_name = rec.get("pokemonName")

    # Best-effort internal species token.
    pokemon_enum_raw = _strip_known_prefix(
        str(rec.get("pokemon") or ""),
        ["HoloPokemonId_", "HoloPokemonId"],
    )
    pokemon_enum = _camel_to_upper_snake(pokemon_enum_raw) or _camel_to_upper_snake(
        str(pokemon_name or "")
    )

    # Best-effort internal form token (used by our sprite naming logic).
    display = rec.get("display") if isinstance(rec.get("display"), dict) else {}
    display_form_full = str(display.get("form") or "")
    ignore_gmax = _is_false_positive_gigantamax_record(
        rec
    ) or _is_false_positive_gigantamax_display_form(display_form_full)
    form_raw = _strip_known_prefix(
        str(display.get("form") or ""),
        ["PokemonDisplayProto_Form_"],
    )
    form_token = _camel_to_upper_snake(form_raw)
    if not form_token or form_token == "FORM_UNSET":
        form_token = f"{pokemon_enum}_NORMAL" if pokemon_enum else ""
    elif pokemon_enum and not form_token.startswith(pokemon_enum + "_"):
        # Many values are like PIKACHU_NORMAL already; but if not, normalize.
        # If form token already contains pokemon name, leave it as-is.
        if _camel_to_upper_snake(form_raw).startswith(pokemon_enum):
            pass
        else:
            form_token = f"{pokemon_enum}_{form_token}"

    # Dynamax / Gigantamax hint
    dyn = rec.get("dynamax") if isinstance(rec.get("dynamax"), dict) else {}
    if (
        dyn.get("isGigantamaxLikely")
        and (not ignore_gmax)
        and form_token
        and "GIGANTAMAX" not in form_token
    ):
        # Prefer SPECIES_GIGANTAMAX for sprite naming consistency.
        if form_token.endswith("_NORMAL") and pokemon_enum:
            form_token = f"{pokemon_enum}_GIGANTAMAX"
        else:
            form_token = (
                f"{pokemon_enum}_GIGANTAMAX"
                if pokemon_enum
                else f"{form_token}_GIGANTAMAX"
            )

    gender_id = display.get("genderId")
    known_gender = {1: "male", 2: "female", 3: "genderless"}.get(gender_id)
    if not known_gender:
        graw = _strip_known_prefix(
            str(display.get("gender") or ""), ["PokemonDisplayProto_Gender_"]
        )
        gsn = _camel_to_upper_snake(graw)
        known_gender = (
            "male"
            if gsn == "MALE"
            else "female"
            if gsn == "FEMALE"
            else "genderless"
            if "GENDERLESS" in gsn
            else ""
        )

    is_shiny = bool(display.get("isShiny"))
    is_lucky = bool(rec.get("isLucky"))

    # Shadow / Purified (SpeedUnlocker exports these explicitly)
    is_shadow = bool(rec.get("isShadow"))
    is_purified = bool(rec.get("isPurified"))
    alignment = "SHADOW" if is_shadow else ("PURIFIED" if is_purified else "")

    moves = rec.get("moves") if isinstance(rec.get("moves"), dict) else {}
    fast_raw = _strip_known_prefix(str(moves.get("fast") or ""), ["HoloPokemonMove_"])
    charged_raw = _strip_known_prefix(
        str(moves.get("charged") or ""), ["HoloPokemonMove_"]
    )

    # Convert things like ZenHeadbuttFast -> ZEN_HEADBUTT_FAST (so our display normalizer works).
    fast_token = _camel_to_upper_snake(fast_raw)
    charged_token = _camel_to_upper_snake(charged_raw)

    iv = rec.get("iv") if isinstance(rec.get("iv"), dict) else {}

    return {
        "id": str(rec.get("creationTimeMs") or uuid.uuid4()),
        "number": dex_number,
        "form": form_token,
        "name": str(pokemon_name or pokemon_enum_raw or "").replace("_", " ").title(),
        "cp": rec.get("cp", 0),
        "hp": rec.get("stamina", 0),
        "attack": iv.get("atk", 0),
        "defence": iv.get("def", 0),
        "stamina": iv.get("sta", 0),
        "height": rec.get("heightM", 0),
        "weight": rec.get("weightKg", 0),
        "gender": known_gender or "",
        "alignment": alignment,
        "isshiny": "YES" if is_shiny else "NO",
        "islucky": "YES" if is_lucky else "NO",
        "move_1": fast_token,
        "move_2": charged_token,
        # Keep a simple hint for downstream consumers too.
        "gigantamax": bool(dyn.get("isGigantamaxLikely")) and (not ignore_gmax),
    }


def get_user_files_metadata(user_id):
    """Get list of files for a user"""
    uploads_dir = os.path.join(os.path.dirname(__file__), "uploads", user_id)
    if not os.path.exists(uploads_dir):
        return []

    def _is_uuid(s: str) -> bool:
        try:
            uuid.UUID(s)
            return True
        except Exception:
            return False

    def _meta_path(file_uuid: str) -> str:
        return os.path.join(uploads_dir, f"{file_uuid}.meta.json")

    def _read_meta(file_uuid: str) -> dict:
        try:
            mp = _meta_path(file_uuid)
            if os.path.exists(mp):
                with open(mp, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return data if isinstance(data, dict) else {}
        except Exception:
            pass
        return {}

    def _write_meta(file_uuid: str, meta: dict) -> None:
        try:
            mp = _meta_path(file_uuid)
            tmp = f"{mp}.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=2)
            os.replace(tmp, mp)
        except Exception:
            pass

    def _public_index_path() -> str:
        return os.path.join(uploads_dir, "..", "public_index.json")

    def _load_public_index() -> dict:
        p = os.path.abspath(_public_index_path())
        try:
            if os.path.exists(p):
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return data if isinstance(data, dict) else {}
        except Exception:
            pass
        return {}

    def _save_public_index(idx: dict) -> None:
        p = os.path.abspath(_public_index_path())
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            tmp = f"{p}.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(idx, f, indent=2)
            os.replace(tmp, p)
        except Exception:
            pass

    def _register_public(file_uuid: str, original_filename: str | None) -> None:
        try:
            idx = _load_public_index()
            idx[file_uuid] = {
                "user_id": user_id,
                "original_filename": original_filename,
                "created_at": datetime.utcnow().isoformat(),
            }
            _save_public_index(idx)
        except Exception:
            pass

    # One-time lazy migration: legacy files were stored as <original_filename>.json.
    # Convert them to UUID-based ids (<uuid>.json) while preserving the original filename in a meta file.
    for filename in list(os.listdir(uploads_dir)):
        if not filename.endswith(".json"):
            continue
        if filename.endswith("_enriched.json"):
            continue
        if filename.endswith(".meta.json"):
            continue

        base = filename[:-5]
        if _is_uuid(base):
            # Ensure meta exists for UUID files (best-effort).
            meta = _read_meta(base)
            if not meta:
                _write_meta(
                    base,
                    {
                        "original_filename": filename,
                        "legacy_id": None,
                    },
                )
            continue

        # Legacy file (non-UUID): rename to UUID and create meta.
        new_uuid = str(uuid.uuid4())
        old_path = os.path.join(uploads_dir, filename)
        new_path = os.path.join(uploads_dir, f"{new_uuid}.json")

        enriched_old = os.path.join(
            uploads_dir, filename.replace(".json", "_enriched.json")
        )
        enriched_new = os.path.join(uploads_dir, f"{new_uuid}_enriched.json")

        try:
            os.replace(old_path, new_path)
            if os.path.exists(enriched_old):
                os.replace(enriched_old, enriched_new)
        except Exception:
            # If migration fails, keep the file as-is.
            continue

        _write_meta(
            new_uuid,
            {
                "original_filename": filename,
                "legacy_id": base,
            },
        )
        _register_public(new_uuid, filename)

    files = []
    for filename in os.listdir(uploads_dir):
        if not filename.endswith(".json"):
            continue
        if filename.endswith("_enriched.json"):
            continue
        if filename.endswith(".meta.json"):
            continue

        filepath = os.path.join(uploads_dir, filename)
        stat = os.stat(filepath)

        # Guard: ignore tiny JSONs that are almost certainly not real Pokémon payloads
        # (e.g., accidentally-migrated meta JSONs). Real exports are typically much larger.
        if stat.st_size < 1024:
            continue

        file_id_clean = filename.replace(".json", "")
        meta = _read_meta(file_id_clean) if _is_uuid(file_id_clean) else {}
        original_filename = meta.get("original_filename") if meta else None
        if not original_filename:
            original_filename = filename

        enriched_path = os.path.join(uploads_dir, f"{file_id_clean}_enriched.json")

        user, date = extract_metadata_from_filename(original_filename)

        files.append(
            {
                "id": file_id_clean,
                "file_id": file_id_clean,
                "filename": original_filename,
                "user": user,
                "date": date,
                "upload_date": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "size": stat.st_size,
                "enriched": os.path.exists(enriched_path),
            }
        )

    files_sorted = sorted(files, key=lambda x: x["upload_date"], reverse=True)

    # Dedupe entries so re-uploads don't show twice in the Select.
    # Prefer logical (user, date) when we can extract it from filename.
    seen: set[tuple] = set()
    deduped = []
    for rec in files_sorted:
        u = rec.get("user")
        d = rec.get("date")
        if u and d:
            key = (u, d)
        else:
            key = (rec.get("filename"),)

        if key in seen:
            continue
        seen.add(key)
        deduped.append(rec)

    return deduped


def pick_image_animated(rec: dict) -> str:
    """
    Retorna apenas o NOME do arquivo .gif (ex.: '660-diggersby-s.gif'),
    se existir em ANIMATED_INDEX. Caso contrário, retorna ''.
    """
    number = rec.get("number")
    name = rec.get("name")
    if number is None or not name:
        return ""

    num = _pad3(number)
    if not num:
        return ""

    species = slugify_species(str(name).replace("_", " "))

    is_shiny = bool(rec.get("isshiny") == "YES" or rec.get("shiny"))
    gender = (rec.get("gender") or "").strip().lower()

    shiny_suffix = "-s" if is_shiny else ""
    gender_variants = ["-f", "-female"] if gender == "female" else [""]

    form_tokens = _form_tokens_from_record(rec)

    candidates = []

    for ftoks in _form_variants_preference(form_tokens):
        form_part = "-" + "-".join(ftoks) if ftoks else ""
        for gtag in gender_variants:
            candidates.append(f"{num}-{species}{form_part}{gtag}{shiny_suffix}.gif")
        if gender == "female":
            candidates.append(f"{num}-{species}{form_part}{shiny_suffix}.gif")

    candidates.append(f"{num}-{species}{shiny_suffix}.gif")
    candidates.append(f"{num}-{species}.gif")

    for cand in candidates:
        if cand in ANIMATED_INDEX:
            return cand

    return ""


def enrich_pokemon(raw_data):
    """Enrich a single pokemon with metadata from master.json"""
    # Remove mon_ prefix and convert keys to lowercase for consistency
    p = {k.replace("mon_", "").lower(): v for k, v in raw_data.items()}

    number = p.get("number")
    form = p.get("form")

    # Try to find in META_MAP with form, then without
    key_with_form = f"{number}_{form}" if form else str(number)
    key_without_form = str(number)

    meta = META_MAP.get(key_with_form) or META_MAP.get(key_without_form, {})

    # Calculate IV percentage
    attack = p.get("attack", 0)
    defence = p.get("defence", 0)
    stamina = p.get("stamina", 0)
    iv = ((attack + defence + stamina) / 45) * 100
    iv_rounded = round(iv, 2)

    # Determine IV tier
    if iv_rounded == 100:
        iv_tier = "4*"
    elif iv_rounded >= 82.2:  # 37-44/45
        iv_tier = "3*"
    elif iv_rounded >= 51.1:  # 23-36/45
        iv_tier = "2*"
    elif iv_rounded > 0:
        iv_tier = "1*"
    else:
        iv_tier = "0*"

    # Gender formatting
    gender = p.get("gender", "").upper()
    gender_symbol = "♂" if gender == "MALE" else ("♀" if gender == "FEMALE" else "⚲")

    # Shiny and Lucky status
    is_shiny = p.get("isshiny", "NO").upper() == "YES"
    is_lucky = p.get("islucky", "NO").upper() == "YES"

    # Shadow and Purified status
    alignment = p.get("alignment", "").upper()
    is_shadow = alignment == "SHADOW"
    is_purified = alignment == "PURIFIED"

    # Check special combinations
    is_shundo = is_shiny and iv_rounded == 100
    is_nundo = attack == 0 and defence == 0 and stamina == 0

    # Calculate size labels
    height = p.get("height", 0)
    weight = p.get("weight", 0)
    height_label = get_size_label(meta.get("pokedex_height"), height)
    weight_label = get_size_label(meta.get("pokedex_weight"), weight)

    enriched = {
        # Original data
        "id": raw_data.get("id", str(uuid.uuid4())),
        "number": number,
        "form": form,
        "name": p.get("name", "").replace("_", " ").title(),
        "cp": p.get("cp", 0),
        "hp": p.get("hp", 0),
        # IVs
        "attack": attack,
        "defence": defence,
        "stamina": stamina,
        "iv": iv_rounded,
        "iv_tier": iv_tier,
        # Physical attributes
        "height": height,
        "weight": weight,
        "height_label": height_label,
        "weight_label": weight_label,
        "gender": gender.lower(),
        "gender_symbol": gender_symbol,
        # Special status
        "shiny": is_shiny,
        "lucky": is_lucky,
        "shundo": is_shundo,
        "nundo": is_nundo,
        "shadow": is_shadow,
        "purified": is_purified,
        "apex": form in ["LUGIA_S", "HO_OH_S"],
        "costume": p.get("costume"),
        # Moves
        "move_1": p.get("move_1", "").replace("_FAST", "").replace("_", " ").title(),
        "move_2": p.get("move_2", "").replace("_", " ").title(),
        # Metadata from master.json
        "family": meta.get("family"),
        "types": meta.get("types", []),
        "legendary": meta.get("legendary", False),
        "mythic": meta.get("mythic", False),
        "pokedex_height": meta.get("pokedex_height"),
        "pokedex_weight": meta.get("pokedex_weight"),
        "base_attack": meta.get("base_atk"),
        "base_defence": meta.get("base_def"),
        "base_stamina": meta.get("base_sta"),
        # Search helpers
        "search_text": f"{p.get('name', '').lower()} {number} {' '.join(meta.get('types', []))}".lower(),
    }

    # Generate image path
    enriched["image"] = get_image_path(enriched)
    enriched["image_animated"] = pick_image_animated(enriched)

    return enriched


# API Routes
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "message": "API is running"})


def _find_frontend_3d_root() -> Path | None:
    """Locate the 3D assets folder.

    In dev, assets live in ../frontend/public/3d.
    In prod (Docker), CRA build copies public/3d into the build folder.
    """

    candidates: list[Path] = []

    # 1) If we are serving a CRA build via Flask, try build/3d first.
    try:
        if app.static_folder:
            candidates.append(Path(app.static_folder) / "3d")
    except Exception:
        pass

    # 2) Dev fallback: frontend/public/3d (repo layout)
    try:
        candidates.append(
            (Path(__file__).resolve().parent.parent / "frontend" / "public" / "3d")
        )
        candidates.append(
            (
                Path(__file__).resolve().parent / ".." / "frontend" / "public" / "3d"
            ).resolve()
        )
    except Exception:
        pass

    for p in candidates:
        try:
            if p.exists() and p.is_dir():
                return p
        except Exception:
            continue
    return None


def _pick_first_png(rig_dir: Path, patterns: list[str]) -> str | None:
    for pat in patterns:
        hits = sorted(rig_dir.glob(pat))
        if hits:
            return hits[0].name
    return None


@app.route("/api/render/3d/<int:pokemon_id>", methods=["GET"])
def render_3d_config(pokemon_id: int):
    """Return the FBX + textureMap for a given pokedex id.

    The frontend viewer will load assets directly from /3d/... served by CRA (dev)
    or by the Flask static build (prod).
    """

    root = _find_frontend_3d_root()
    if not root:
        return jsonify({"error": "3d assets root not found"}), 404

    pm = f"pm{pokemon_id:04d}"
    species_dir = root / pm
    if not species_dir.exists() or not species_dir.is_dir():
        return jsonify({"error": f"species folder not found: {pm}"}), 404

    preferred_rig = f"{pm}_00_Rig"
    rig_dir = species_dir / preferred_rig
    if not rig_dir.exists() or not rig_dir.is_dir():
        # Some exports contain multiple rig folders like "pmXXXX_00_Rig #...".
        candidates = sorted(
            [
                p
                for p in species_dir.iterdir()
                if p.is_dir() and p.name.startswith(preferred_rig)
            ]
        )
        rig_dir = None
        for c in candidates:
            if any(c.glob("*.fbx")):
                rig_dir = c
                break
        if rig_dir is None:
            return jsonify({"error": f"rig folder not found for: {pm}"}), 404

    fbx_files = sorted(rig_dir.glob("*.fbx"))
    if not fbx_files:
        return jsonify({"error": f"fbx not found in: {rig_dir.name}"}), 404

    # Heuristics based on the provided pm0001 folder naming.
    body_png = _pick_first_png(
        rig_dir, ["*_BodyAll*.png", "*BodyAll*.png", "*_Body*.png", "*Body*.png"]
    )
    eye_png = _pick_first_png(
        rig_dir, ["*_Eye1*.png", "*Eye1*.png", "*_Eye*.png", "*Eye*.png"]
    )

    texture_map: dict[str, str] = {}
    if body_png:
        texture_map["Body_SHINY"] = body_png
    if eye_png:
        texture_map["Eye"] = eye_png
        texture_map["Eye1"] = eye_png
        texture_map["Eye_MATERIAL"] = eye_png

    base_url = f"/3d/{pm}/{rig_dir.name}/"

    return jsonify(
        {
            "pokemonId": pokemon_id,
            "pm": pm,
            "rigFolder": rig_dir.name,
            "baseUrl": base_url,
            "fbx": fbx_files[0].name,
            "textureMap": texture_map,
        }
    )


@app.route("/api/upload", methods=["POST"])
def upload_json():
    """Upload and enrich a Pokemon JSON file"""
    user_id = request.form.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id is required"}), 400

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if file.filename == "" or not file.filename.endswith(".json"):
        return jsonify({"error": "Invalid file. Must be a JSON file"}), 400

    # Create user directory
    user_dir = os.path.join(os.path.dirname(__file__), "uploads", user_id)
    os.makedirs(user_dir, exist_ok=True)

    # Store under a UUID so /dex/<uuid> can be shared publicly.
    file_uuid = str(uuid.uuid4())
    filepath = os.path.join(user_dir, f"{file_uuid}.json")
    file.save(filepath)

    # Parse and enrich
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            raw_data = json.load(f)

        if not isinstance(raw_data, dict):
            return jsonify({"error": "Invalid JSON format. Expected an object"}), 400

        # Support multiple export formats:
        # - Legacy: { fileData: { id: {...}, ... } } or direct dict of pokemon
        # - New (SpeedUnlocker-style): { pokemons: [ {...}, ... ], slugTemplates: {...}, knownSlugMaps: {...} }
        is_speedunlocker = isinstance(raw_data.get("pokemons"), list)
        if is_speedunlocker:
            pokemon_records = raw_data.get("pokemons")
        else:
            pokemon_records = raw_data.get("fileData", raw_data)

        if not isinstance(pokemon_records, (dict, list)):
            return jsonify(
                {"error": "Invalid JSON format. Expected pokemon data as dict or list"}
            ), 400

        # Track progress by UUID
        file_id = file_uuid
        total = (
            len(pokemon_records)
            if isinstance(pokemon_records, list)
            else len(pokemon_records)
            if isinstance(pokemon_records, dict)
            else 0
        )
        ENRICHMENT_PROGRESS[file_id] = {
            "current": 0,
            "total": total,
            "status": "processing",
        }

        enriched_data: list[dict] = []

        if isinstance(pokemon_records, dict):
            for idx, (pokemon_id, pokemon) in enumerate(pokemon_records.items()):
                pokemon_copy = dict(pokemon) if isinstance(pokemon, dict) else {}
                pokemon_copy["id"] = pokemon_id
                enriched = enrich_pokemon(pokemon_copy)
                enriched_data.append(enriched)
                ENRICHMENT_PROGRESS[file_id]["current"] = idx + 1
        elif isinstance(pokemon_records, list):
            for idx, pokemon in enumerate(pokemon_records):
                if not isinstance(pokemon, dict):
                    ENRICHMENT_PROGRESS[file_id]["current"] = idx + 1
                    continue

                if is_speedunlocker:
                    mapped = _speedunlocker_to_legacy_payload(pokemon)
                    enriched = enrich_pokemon(mapped)

                    # Preserve the full original record (ALL fields) without key collisions.
                    enriched["source"] = pokemon

                    # Surface a few high-value raw fields directly for frontend use.
                    enriched["hp_max"] = pokemon.get("maxStamina")
                    enriched["hp_current"] = pokemon.get("stamina")
                    enriched["cp_multiplier"] = pokemon.get("cpMultiplier")
                    enriched["captured_s2_cell_id"] = pokemon.get("capturedS2CellId")
                    enriched["display"] = pokemon.get("display")
                    enriched["dynamax"] = pokemon.get("dynamax")
                    _ignore_gmax = _is_false_positive_gigantamax_record(pokemon)
                    enriched["gigantamax"] = bool(
                        (pokemon.get("dynamax") or {}).get("isGigantamaxLikely")
                        if isinstance(pokemon.get("dynamax"), dict)
                        else False
                    ) and (not _ignore_gmax)
                    enriched["origin"] = pokemon.get("origin")
                    enriched["trade"] = pokemon.get("trade")
                    enriched["pokeball"] = pokemon.get("pokeball")
                    enriched["pokeball_id"] = pokemon.get("pokeballId")
                else:
                    pokemon_copy = dict(pokemon)
                    if "id" not in pokemon_copy:
                        pokemon_copy["id"] = str(idx)
                    enriched = enrich_pokemon(pokemon_copy)

                enriched_data.append(enriched)
                ENRICHMENT_PROGRESS[file_id]["current"] = idx + 1

        # Save enriched file
        enriched_path = filepath.replace(".json", "_enriched.json")
        with open(enriched_path, "w", encoding="utf-8") as f:
            json.dump(enriched_data, f, indent=2)

        ENRICHMENT_PROGRESS[file_id]["status"] = "completed"

        user, date = extract_metadata_from_filename(file.filename)

        # Save per-file meta (preserve original filename for display)
        try:
            meta_path = os.path.join(user_dir, f"{file_uuid}.meta.json")
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "original_filename": file.filename,
                        "legacy_id": file.filename.replace(".json", ""),
                        "user": user,
                        "date": date,
                        "upload_date": datetime.utcnow().isoformat(),
                        "total_pokemon": len(enriched_data),
                        "enriched": True,
                        "export_format": "speedunlocker"
                        if is_speedunlocker
                        else "legacy",
                        "source_slug_templates": raw_data.get("slugTemplates")
                        if is_speedunlocker
                        else None,
                        "source_known_slug_maps": raw_data.get("knownSlugMaps")
                        if is_speedunlocker
                        else None,
                    },
                    f,
                    indent=2,
                )
        except Exception:
            pass

        # Register in a global public index so /dex/<uuid> is publicly shareable.
        try:
            public_index_path = os.path.join(
                os.path.dirname(__file__), "uploads", "public_index.json"
            )
            idx = {}
            if os.path.exists(public_index_path):
                with open(public_index_path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                if isinstance(loaded, dict):
                    idx = loaded
            idx[file_uuid] = {
                "user_id": user_id,
                "original_filename": file.filename,
                "created_at": datetime.utcnow().isoformat(),
            }
            tmp = f"{public_index_path}.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(idx, f, indent=2)
            os.replace(tmp, public_index_path)
        except Exception:
            pass

        # Keep only the newest export per logical "user" inside the filename.
        # Example: Pokemons-JaspionHunter-02-12-2025.json then Pokemons-JaspionHunter-12-12-2025.json
        # => keep the newest date, remove older ones.
        if user and date:
            try:
                new_dt = datetime.fromisoformat(date)
            except Exception:
                new_dt = None

            if new_dt is not None:

                def _safe_read_meta(fid: str) -> dict:
                    try:
                        mp = os.path.join(user_dir, f"{fid}.meta.json")
                        if os.path.exists(mp):
                            with open(mp, "r", encoding="utf-8") as f:
                                loaded = json.load(f)
                            return loaded if isinstance(loaded, dict) else {}
                    except Exception:
                        pass
                    return {}

                def _delete_uuid_files(fid: str) -> None:
                    for fn in [
                        f"{fid}.json",
                        f"{fid}_enriched.json",
                        f"{fid}.meta.json",
                    ]:
                        fp = os.path.join(user_dir, fn)
                        try:
                            if os.path.exists(fp):
                                os.remove(fp)
                        except Exception:
                            pass

                # Load public index once (best-effort)
                idx = None
                try:
                    public_index_path = os.path.join(
                        os.path.dirname(__file__), "uploads", "public_index.json"
                    )
                    if os.path.exists(public_index_path):
                        with open(public_index_path, "r", encoding="utf-8") as f:
                            loaded = json.load(f)
                        if isinstance(loaded, dict):
                            idx = loaded
                except Exception:
                    idx = None

                changed_idx = False

                for fn in os.listdir(user_dir):
                    if not fn.endswith(".meta.json"):
                        continue
                    fid = fn[: -len(".meta.json")]
                    if fid == file_uuid:
                        continue

                    meta = _safe_read_meta(fid)
                    orig = meta.get("original_filename")
                    if not orig or not isinstance(orig, str):
                        continue

                    old_user, old_date = extract_metadata_from_filename(orig)
                    if old_user != user or not old_date:
                        continue

                    try:
                        old_dt = datetime.fromisoformat(old_date)
                    except Exception:
                        continue

                    # Older OR same logical date => overwrite (avoid duplicates on re-upload)
                    if old_dt <= new_dt:
                        _delete_uuid_files(fid)
                        if isinstance(idx, dict) and fid in idx:
                            idx.pop(fid, None)
                            changed_idx = True

                if changed_idx and isinstance(idx, dict):
                    try:
                        public_index_path = os.path.join(
                            os.path.dirname(__file__), "uploads", "public_index.json"
                        )
                        tmp = f"{public_index_path}.tmp"
                        with open(tmp, "w", encoding="utf-8") as f:
                            json.dump(idx, f, indent=2)
                        os.replace(tmp, public_index_path)
                    except Exception:
                        pass

        return jsonify(
            {
                "message": "File uploaded and enriched successfully",
                "file_id": file_uuid,
                "filename": file.filename,
                "user": user,
                "date": date,
                "total_pokemon": len(enriched_data),
                "enriched": True,
            }
        )

    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON file"}), 400
    except Exception as e:
        return jsonify({"error": f"Error processing file: {str(e)}"}), 500


@app.route("/api/files/<user_id>", methods=["GET"])
def list_user_files(user_id):
    """List all files uploaded by a user"""
    files = get_user_files_metadata(user_id)
    return jsonify({"user_id": user_id, "files": files})


@app.route("/api/progress/<file_id>", methods=["GET"])
def get_progress(file_id):
    """Get enrichment progress for a file"""
    progress = ENRICHMENT_PROGRESS.get(
        file_id, {"current": 0, "total": 0, "status": "not_found"}
    )
    return jsonify(progress)


@app.route("/api/pvp/categories", methods=["GET"])
def get_pvp_categories():
    """List available PvP ranking categories."""
    return jsonify({"categories": PVP_CATEGORIES})


@app.route("/api/public/file/<file_id>", methods=["GET"])
def get_public_file_data(file_id):
    """Public (shareable) read-only access to a file by UUID.

    This does NOT add the file to the visitor's list; it only serves the data.
    """
    try:
        # Only UUIDs are supported for public access.
        uuid.UUID(str(file_id))
    except Exception:
        return jsonify({"error": "Invalid file id"}), 400

    public_index_path = os.path.join(
        os.path.dirname(__file__), "uploads", "public_index.json"
    )
    if not os.path.exists(public_index_path):
        return jsonify({"error": "File not found"}), 404

    try:
        with open(public_index_path, "r", encoding="utf-8") as f:
            idx = json.load(f)
        if not isinstance(idx, dict):
            return jsonify({"error": "File not found"}), 404
        entry = idx.get(str(file_id))
        if not isinstance(entry, dict):
            return jsonify({"error": "File not found"}), 404
        user_id = entry.get("user_id")
        if not user_id:
            return jsonify({"error": "File not found"}), 404
    except Exception:
        return jsonify({"error": "File not found"}), 404

    # Reuse the existing per-user loader by calling the same logic as /api/file.
    # This keeps filtering, sorting, PvP, Best Teams behavior identical.
    return get_file_data(user_id, str(file_id))


@app.route("/api/file/<user_id>/<path:file_id>", methods=["DELETE"])
def delete_file(user_id, file_id):
    """Delete a file and its enriched version"""
    try:
        user_dir = os.path.join(os.path.dirname(__file__), "uploads", user_id)

        # If this is a UUID id, delete the UUID-named files (+ meta) and unregister from public index.
        try:
            uuid.UUID(str(file_id))
            uuid_id = str(file_id)
            deleted_files = []

            for fn in [
                f"{uuid_id}.json",
                f"{uuid_id}_enriched.json",
                f"{uuid_id}.meta.json",
            ]:
                fp = os.path.join(user_dir, fn)
                if os.path.exists(fp):
                    os.remove(fp)
                    deleted_files.append(fn)

            # Best-effort: remove from global public index
            try:
                public_index_path = os.path.join(
                    os.path.dirname(__file__), "uploads", "public_index.json"
                )
                if os.path.exists(public_index_path):
                    with open(public_index_path, "r", encoding="utf-8") as f:
                        idx = json.load(f)
                    if isinstance(idx, dict) and uuid_id in idx:
                        idx.pop(uuid_id, None)
                        tmp = f"{public_index_path}.tmp"
                        with open(tmp, "w", encoding="utf-8") as f:
                            json.dump(idx, f, indent=2)
                        os.replace(tmp, public_index_path)
            except Exception:
                pass

            if deleted_files:
                return (
                    jsonify(
                        {
                            "success": True,
                            "message": f"Deleted {len(deleted_files)} file(s)",
                            "deleted_files": deleted_files,
                        }
                    ),
                    200,
                )
            return jsonify({"error": "File not found"}), 404
        except Exception:
            pass

        # Try both formats: direct filename and user-date format
        possible_files = []

        # Direct filename
        if file_id.endswith(".json"):
            possible_files.append(file_id)
            possible_files.append(file_id.replace(".json", "_enriched.json"))
        else:
            possible_files.append(f"{file_id}.json")
            possible_files.append(f"{file_id}_enriched.json")

        # Also check for files matching user-date pattern
        if os.path.exists(user_dir):
            for filename in os.listdir(user_dir):
                if filename.endswith(".json"):
                    # Extract user and date from filename
                    match = re.match(
                        r"Pokemons-([^-]+)-(\d{2}-\d{2}-\d{4})\.json", filename
                    )
                    if match:
                        file_user = match.group(1)
                        file_date = match.group(2)
                        # Convert date format from DD-MM-YYYY to YYYY-MM-DD for comparison
                        parts = file_date.split("-")
                        if len(parts) == 3:
                            iso_date = f"{parts[2]}-{parts[1]}-{parts[0]}"
                            file_pattern = f"{file_user} - {iso_date}"
                            if file_pattern == file_id:
                                possible_files.append(filename)
                                possible_files.append(
                                    filename.replace(".json", "_enriched.json")
                                )

        deleted_files = []
        for filename in possible_files:
            filepath = os.path.join(user_dir, filename)
            if os.path.exists(filepath):
                os.remove(filepath)
                deleted_files.append(filename)

        if deleted_files:
            return jsonify(
                {
                    "success": True,
                    "message": f"Deleted {len(deleted_files)} file(s)",
                    "deleted_files": deleted_files,
                }
            ), 200
        else:
            return jsonify({"error": "File not found"}), 404

    except Exception as e:
        return jsonify({"error": str(e)}), 500


def apply_search_filter(pokemon_list, search_query):
    """
    Apply Pokemon GO style search filtering
    Supports: name, number ranges, cp/hp ranges, iv stars, types,
    shiny, shadow, purified, lucky, gender, and logical operators
    """
    search_query = search_query.strip().lower()

    if not search_query:
        return pokemon_list

    # Handle logical operators: & (AND), , or ; (OR)
    # Parse OR first (,  or ;)
    if "," in search_query or ";" in search_query:
        or_parts = re.split(r"[,;]", search_query)
        results = []
        for part in or_parts:
            part_results = apply_search_filter(pokemon_list, part.strip())
            # Add unique results
            for p in part_results:
                if p not in results:
                    results.append(p)
        return results

    # Handle AND (&)
    if "&" in search_query:
        and_parts = search_query.split("&")
        results = pokemon_list
        for part in and_parts:
            results = apply_search_filter(results, part.strip())
        return results

    # Handle NOT (!)
    if search_query.startswith("!"):
        negated = search_query[1:]
        matching = apply_search_filter(pokemon_list, negated)
        return [p for p in pokemon_list if p not in matching]

    # Prepare filtered list
    filtered = []

    for pokemon in pokemon_list:
        match = False

        def _truthy(v) -> bool:
            if isinstance(v, bool):
                return v
            if isinstance(v, (int, float)):
                return v != 0
            if isinstance(v, str):
                return v.strip().lower() in {"1", "true", "yes", "y"}
            return False

        def _is_gigantamax(p: dict) -> bool:
            if not isinstance(p, dict):
                return False
            if _is_false_positive_gigantamax_record(p):
                return False
            if bool(p.get("gigantamax")):
                return True
            dyn = p.get("dynamax")
            return isinstance(dyn, dict) and bool(dyn.get("isGigantamaxLikely"))

        def _is_dynamax_only(p: dict) -> bool:
            if not isinstance(p, dict):
                return False
            if _is_gigantamax(p):
                return False
            dyn = p.get("dynamax")
            if isinstance(dyn, dict):
                return len(dyn.keys()) > 0
            if isinstance(dyn, bool):
                return dyn
            return False

        def _has_special_background(p: dict) -> bool:
            """True when the Pokémon has a location card background (not the type background)."""
            if not isinstance(p, dict):
                return False

            def _check_display(d: dict) -> bool:
                if not isinstance(d, dict):
                    return False
                # Prefer explicit boolean when present.
                if bool(d.get("hasLocationCard")):
                    return True
                lc = d.get("locationCard")
                if isinstance(lc, dict):
                    nm = str(lc.get("name") or "").strip()
                    if nm and "unset" not in nm.lower():
                        return True
                # Some exports may surface name directly.
                nm2 = str(d.get("locationCardName") or "").strip()
                if nm2 and "unset" not in nm2.lower():
                    return True
                return False

            if _check_display(
                p.get("display") if isinstance(p.get("display"), dict) else {}
            ):
                return True

            # Enriched records store original SpeedUnlocker record under "source".
            src = p.get("source")
            if isinstance(src, dict):
                disp2 = src.get("display")
                if isinstance(disp2, dict) and _check_display(disp2):
                    return True

            return False

        # Special keywords
        if search_query == "apex":
            if pokemon.get("apex"):
                filtered.append(pokemon)
            continue

        # Family search: +pikachu
        if search_query.startswith("+"):
            family_name = search_query[1:]
            pokemon_family = pokemon.get("family", "").lower()
            if family_name in pokemon_family:
                filtered.append(pokemon)
            continue

        # CP range: cp{N}, cp{N}-, cp-{N}, cp{N}-{M}
        if search_query.startswith("cp"):
            match = match_range(search_query, "cp", pokemon.get("cp", 0))

        # HP range
        elif search_query.startswith("hp"):
            match = match_range(search_query, "hp", pokemon.get("hp", 0))

        # Attack range: atk{N}, atk{N}-, atk-{N}, atk{N}-{M}
        elif search_query.startswith("atk"):
            match = match_range(search_query, "atk", pokemon.get("attack", 0))

        # Defence range: def{N}, def{N}-, def-{N}, def{N}-{M}
        elif search_query.startswith("def"):
            match = match_range(search_query, "def", pokemon.get("defence", 0))

        # Stamina range: stm{N}, stm{N}-, stm-{N}, stm{N}-{M}
        elif search_query.startswith("stm"):
            match = match_range(search_query, "stm", pokemon.get("stamina", 0))

        # Number range: {N}, {N}-, -{N}, {N}-{M}
        elif re.match(r"^\d+(-\d*)?$|^-\d+$", search_query):
            match = match_number_range(search_query, pokemon.get("number", 0))

        # IV stars: 0*, 1*, 2*, 3*, 4*
        elif re.match(r"^[0-4]\*$", search_query):
            star = int(search_query[0])
            tier = pokemon.get("iv_tier", "")
            match = tier == f"{star}*"

        # Keywords: shiny, shadow, purified, lucky, legendary, mythical
        elif search_query in ["shiny", "shadow", "purified", "lucky"]:
            match = _truthy(pokemon.get(search_query, False))

        elif search_query in ["legendary", "mythical"]:
            match = _truthy(pokemon.get(search_query, False))

        # Gender: male, female, genderunknown
        elif search_query in ["male", "female"]:
            match = pokemon.get("gender", "").lower() == search_query
        elif search_query == "genderunknown":
            match = pokemon.get("gender", "").lower() not in ["male", "female"]

        # Size: xxs, xs, xl, xxl
        elif search_query in ["xxs", "xs", "xl", "xxl"]:
            match = (
                pokemon.get("height_label", "").lower() == search_query
                or pokemon.get("weight_label", "").lower() == search_query
            )

        # Types
        elif search_query in [
            "normal",
            "fire",
            "water",
            "electric",
            "grass",
            "ice",
            "fighting",
            "poison",
            "ground",
            "flying",
            "psychic",
            "bug",
            "rock",
            "ghost",
            "dragon",
            "dark",
            "steel",
            "fairy",
        ]:
            types = pokemon.get("types", [])
            match = search_query in types

        # Costume
        elif search_query == "costume":
            match = pokemon.get("costume") is not None and pokemon.get("costume") != ""

        # Shundo (shiny + 4*)
        elif search_query == "shundo":
            match = pokemon.get("shundo", False) == True

        # Nundo (0/0/0)
        elif search_query == "nundo":
            match = pokemon.get("nundo", False) == True

        # Dynamax / Gigantamax
        elif search_query in ["gigantamax", "gmax"]:
            match = _is_gigantamax(pokemon)
        elif search_query == "dynamax":
            match = _is_dynamax_only(pokemon) or _is_gigantamax(pokemon)

        # Special background (location card)
        elif search_query == "background":
            match = _has_special_background(pokemon)

        # Default: search in name or form
        else:
            name = pokemon.get("name", "").lower()
            form = pokemon.get("form", "") or ""
            form = form.lower()
            search_text = pokemon.get("search_text", "").lower()

            match = (
                search_query in name
                or search_query in form
                or search_query in search_text
            )

        if match:
            filtered.append(pokemon)

    return filtered


def filter_unique_pokemon(pokemon_list):
    """
    Filter to return only unique pokemon per species and special characteristics.
    For each species (number), returns one pokemon of each special type:
    - normal (no special characteristics)
    - shiny
    - shadow
    - purified
    - apex
    - lucky (combined with above)

    Example: 4 Bulbasaurs (2 shadow, 2 shiny) -> returns 1 shadow, 1 shiny
    """
    unique_map = {}

    for pokemon in pokemon_list:
        number = pokemon.get("number")
        if number is None:
            continue

        # Include costume in uniqueness. Costumed variants should not be dropped
        # when unique mode is enabled, but should still deduplicate within the same costume.
        costume_raw = pokemon.get("costume")
        costume_key = "" if costume_raw is None else str(costume_raw)

        # Include form in uniqueness. Different forms (e.g., Alolan/Galar/variants)
        # should be considered unique even for the same Dex number/costume.
        form_raw = pokemon.get("form")
        form_key = "" if form_raw is None else str(form_raw)

        # Determine the special characteristics
        is_shiny = pokemon.get("shiny", False)
        is_shadow = pokemon.get("shadow", False)
        is_purified = pokemon.get("purified", False)
        is_apex = pokemon.get("apex", False)
        is_lucky = pokemon.get("lucky", False)

        # Create a key based on species and special characteristics
        # Priority: apex > shiny > shadow > purified > normal
        if is_apex:
            key = (number, costume_key, form_key, "apex", is_lucky)
        elif is_shiny:
            key = (number, costume_key, form_key, "shiny", is_lucky)
        elif is_shadow:
            key = (number, costume_key, form_key, "shadow", is_lucky)
        elif is_purified:
            key = (number, costume_key, form_key, "purified", is_lucky)
        else:
            key = (number, costume_key, form_key, "normal", is_lucky)

        # Keep the pokemon with the largest size (XXL > XL > normal > XS > XXS)
        size_priority = {
            "xxl": 5,
            "xl": 4,
            "": 3,  # normal (no size)
            "xs": 2,
            "xxs": 1,
        }

        if key not in unique_map:
            unique_map[key] = pokemon
        else:
            # Keep the one with larger size (using weight_label)
            existing = unique_map[key]
            current_size = pokemon.get("weight_label", "").lower()
            existing_size = existing.get("weight_label", "").lower()

            current_priority = size_priority.get(current_size, 3)
            existing_priority = size_priority.get(existing_size, 3)

            if current_priority > existing_priority:
                unique_map[key] = pokemon

    return list(unique_map.values())


def match_range(query, prefix, value):
    """Match range queries like cp100, cp100-, cp-100, cp100-200"""
    try:
        query = query[len(prefix) :]

        if "-" not in query:
            # Exact match: cp100
            return value == int(query)

        parts = query.split("-")

        if query.startswith("-"):
            # Upper bound: cp-100
            max_val = int(parts[1])
            return value <= max_val

        elif query.endswith("-"):
            # Lower bound: cp100-
            min_val = int(parts[0])
            return value >= min_val

        else:
            # Range: cp100-200
            min_val = int(parts[0])
            max_val = int(parts[1]) if parts[1] else 999999
            return min_val <= value <= max_val

    except (ValueError, IndexError):
        return False


def match_number_range(query, number):
    """Match Pokemon number ranges"""
    try:
        if "-" not in query:
            # Exact: 25
            return number == int(query)

        parts = query.split("-")

        if query.startswith("-"):
            # Upper: -151
            max_num = int(parts[1])
            return number <= max_num

        elif query.endswith("-"):
            # Lower: 100-
            min_num = int(parts[0])
            return number >= min_num

        else:
            # Range: 1-151
            min_num = int(parts[0])
            max_num = int(parts[1])
            return min_num <= number <= max_num

    except (ValueError, IndexError):
        return False


@app.route("/api/file/<user_id>/<path:file_id>", methods=["GET"])
def get_file_data(user_id, file_id):
    """Get enriched Pokemon data for a specific file with optional filtering and sorting"""
    # Try to find the enriched file
    user_dir = os.path.join(os.path.dirname(__file__), "uploads", user_id)

    if not os.path.exists(user_dir):
        return jsonify({"error": "User directory not found"}), 404

    # Decode URL-encoded file_id
    from urllib.parse import unquote

    file_id = unquote(file_id)

    def _is_uuid(s: str) -> bool:
        try:
            uuid.UUID(s)
            return True
        except Exception:
            return False

    def _read_meta(fid: str) -> dict:
        try:
            mp = os.path.join(user_dir, f"{fid}.meta.json")
            if os.path.exists(mp):
                with open(mp, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                return meta if isinstance(meta, dict) else {}
        except Exception:
            pass
        return {}

    def _build_enriched_from_raw(raw_path: str, out_path: str) -> bool:
        """Best-effort: build <uuid>_enriched.json from the raw uploaded JSON.

        This makes the system resilient when legacy uploads exist without an enriched
        companion file (or when a migration didn't move it).
        """
        try:
            with open(raw_path, "r", encoding="utf-8") as f:
                raw_data = json.load(f)

            enriched_data: list[dict] = []

            # Case 1: already a list (might already be enriched)
            if isinstance(raw_data, list):
                for idx, p in enumerate(raw_data):
                    if not isinstance(p, dict):
                        continue
                    pcopy = dict(p)
                    if "id" not in pcopy:
                        pcopy["id"] = str(pcopy.get("id") or idx)
                    # If it already looks enriched, keep it; otherwise enrich.
                    if "number" in pcopy and "image" in pcopy:
                        enriched_data.append(pcopy)
                    else:
                        enriched_data.append(enrich_pokemon(pcopy))

            # Case 2: dict wrapper (original upload format or SpeedUnlocker export)
            elif isinstance(raw_data, dict):
                # Guard: sometimes metadata files accidentally sit next to uploads; don't treat them as Pokémon payloads.
                if (
                    "original_filename" in raw_data
                    and "legacy_id" in raw_data
                    and "fileData" not in raw_data
                ):
                    return False

                # SpeedUnlocker-style export: { pokemons: [ ... ], slugTemplates: {...}, knownSlugMaps: {...} }
                if isinstance(raw_data.get("pokemons"), list):
                    for idx, pokemon in enumerate(raw_data.get("pokemons") or []):
                        if not isinstance(pokemon, dict):
                            continue
                        mapped = _speedunlocker_to_legacy_payload(pokemon)
                        enriched = enrich_pokemon(mapped)
                        enriched["source"] = pokemon
                        enriched["hp_max"] = pokemon.get("maxStamina")
                        enriched["hp_current"] = pokemon.get("stamina")
                        enriched["cp_multiplier"] = pokemon.get("cpMultiplier")
                        enriched["captured_s2_cell_id"] = pokemon.get(
                            "capturedS2CellId"
                        )
                        enriched["display"] = pokemon.get("display")
                        enriched["dynamax"] = pokemon.get("dynamax")
                        _ignore_gmax = _is_false_positive_gigantamax_record(pokemon)
                        enriched["gigantamax"] = bool(
                            (pokemon.get("dynamax") or {}).get("isGigantamaxLikely")
                            if isinstance(pokemon.get("dynamax"), dict)
                            else False
                        ) and (not _ignore_gmax)
                        enriched["origin"] = pokemon.get("origin")
                        enriched["trade"] = pokemon.get("trade")
                        enriched["pokeball"] = pokemon.get("pokeball")
                        enriched["pokeball_id"] = pokemon.get("pokeballId")
                        enriched_data.append(enriched)
                    # fall through to save
                else:
                    pokemon_data = raw_data.get("fileData", raw_data)
                    if isinstance(pokemon_data, dict):
                        for pokemon_id, pokemon in pokemon_data.items():
                            pokemon_copy = (
                                dict(pokemon) if isinstance(pokemon, dict) else {}
                            )
                            pokemon_copy["id"] = pokemon_id
                            enriched_data.append(enrich_pokemon(pokemon_copy))
                    elif isinstance(pokemon_data, list):
                        for idx, pokemon in enumerate(pokemon_data):
                            pokemon_copy = (
                                dict(pokemon) if isinstance(pokemon, dict) else {}
                            )
                            if "id" not in pokemon_copy:
                                pokemon_copy["id"] = str(idx)
                            enriched_data.append(enrich_pokemon(pokemon_copy))
                    else:
                        return False
            else:
                return False

            if not enriched_data:
                return False

            tmp = f"{out_path}.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(enriched_data, f, indent=2)
            os.replace(tmp, out_path)

            # Best-effort: update meta to reflect enrichment.
            try:
                fid = os.path.basename(out_path).replace("_enriched.json", "")
                mp = os.path.join(user_dir, f"{fid}.meta.json")
                meta = {}
                if os.path.exists(mp):
                    with open(mp, "r", encoding="utf-8") as f:
                        loaded = json.load(f)
                    if isinstance(loaded, dict):
                        meta = loaded
                meta["enriched"] = True
                meta["total_pokemon"] = int(
                    meta.get("total_pokemon") or len(enriched_data)
                )
                tmpm = f"{mp}.tmp"
                with open(tmpm, "w", encoding="utf-8") as f:
                    json.dump(meta, f, indent=2)
                os.replace(tmpm, mp)
            except Exception:
                pass

            return True
        except Exception:
            return False

    # Look for the enriched file - try multiple patterns
    enriched_path = None

    # Fast path: UUID-based file id
    if _is_uuid(file_id):
        p = os.path.join(user_dir, f"{file_id}_enriched.json")
        if os.path.exists(p):
            enriched_path = p
        else:
            # If the enriched file is missing but raw exists, build it on demand.
            raw_path = os.path.join(user_dir, f"{file_id}.json")
            if os.path.exists(raw_path):
                if _build_enriched_from_raw(raw_path, p):
                    enriched_path = p

    # First, try to find by matching user and date from file_id
    if (not enriched_path) and " - " in file_id:
        # file_id is in format "User - Date", need to find matching file
        user_part, date_part = file_id.split(" - ", 1)
        for filename in os.listdir(user_dir):
            if filename.endswith("_enriched.json"):
                user, date = extract_metadata_from_filename(
                    filename.replace("_enriched.json", ".json")
                )
                if user == user_part and date == date_part:
                    enriched_path = os.path.join(user_dir, filename)
                    break

    # If not found, try direct filename match
    if not enriched_path:
        possible_paths = [
            os.path.join(user_dir, f"{file_id}_enriched.json"),
            os.path.join(
                user_dir, f"{file_id}.json_enriched.json"
            ),  # In case file_id has .json
        ]

        for path in possible_paths:
            if os.path.exists(path):
                enriched_path = path
                break

        # If we still don't have an enriched file but a raw JSON exists, build it.
        if not enriched_path:
            # Normalize potential raw name.
            fid_clean = file_id
            if fid_clean.endswith(".json"):
                fid_clean = fid_clean[: -len(".json")]
            raw_candidates = [
                os.path.join(user_dir, f"{fid_clean}.json"),
                os.path.join(user_dir, f"{file_id}.json"),
            ]
            out_candidate = os.path.join(user_dir, f"{fid_clean}_enriched.json")
            for raw_path in raw_candidates:
                if os.path.exists(raw_path):
                    if _build_enriched_from_raw(raw_path, out_candidate):
                        enriched_path = out_candidate
                        file_id = fid_clean
                    break

    # Legacy compat: if file_id is an old "base name" but the file was migrated to UUID,
    # try to find a meta file that references it.
    if (not enriched_path) and (not _is_uuid(file_id)):
        try:
            for fn in os.listdir(user_dir):
                if not fn.endswith(".meta.json"):
                    continue
                fid = fn[: -len(".meta.json")]
                meta = _read_meta(fid)
                if (meta.get("legacy_id") or "") == file_id:
                    p = os.path.join(user_dir, f"{fid}_enriched.json")
                    if os.path.exists(p):
                        enriched_path = p
                        file_id = fid
                        break
        except Exception:
            pass

    if not enriched_path:
        # List available files for debugging
        available_files = os.listdir(user_dir) if os.path.exists(user_dir) else []
        sample = sorted(available_files)[:50]
        print(f"[DEBUG] Looking for file_id: {file_id}")
        print(f"[DEBUG] Available files in {user_dir}: {available_files}")
        return jsonify(
            {
                "error": "Enriched file not found",
                "file_id": file_id,
                "available_files_count": len(available_files),
                "available_files_sample": sample,
            }
        ), 404

    try:
        with open(enriched_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        print(f"[DEBUG] Loaded {len(data)} pokemon from {enriched_path}")

        # Backfill shadow/purified flags from SpeedUnlocker records when present.
        # Some enriched files were generated before we mapped isShadow/isPurified into our canonical fields.
        for p in data if isinstance(data, list) else []:
            if not isinstance(p, dict):
                continue
            src = p.get("source")
            if not isinstance(src, dict):
                continue
            if p.get("shadow") is not True and src.get("isShadow") is True:
                p["shadow"] = True
            if p.get("purified") is not True and src.get("isPurified") is True:
                p["purified"] = True

        # Get query parameters for filtering and sorting
        search = request.args.get("search", "").lower()
        order_by = request.args.get("order_by", "number")
        order_dir = request.args.get("order_dir", "asc")
        unique_only = request.args.get("unique", "").lower() == "true"
        dynamax_only = _parse_bool_arg(request.args.get("dynamax"))
        gigantamax_only = _parse_bool_arg(request.args.get("gigantamax"))
        pvp_enabled = request.args.get("pvp", "").lower() == "true"
        best_teams_enabled = _parse_bool_arg(request.args.get("best_teams"))
        pvp_league = (request.args.get("league", "GL") or "GL").upper()
        pvp_category = (request.args.get("category", "overall") or "overall").lower()
        if pvp_category not in PVP_CATEGORIES:
            pvp_category = "overall"

        def _is_gigantamax(p: dict) -> bool:
            if not isinstance(p, dict):
                return False
            if _is_false_positive_gigantamax_record(p):
                return False
            if bool(p.get("gigantamax")):
                return True
            dyn = p.get("dynamax")
            return isinstance(dyn, dict) and bool(dyn.get("isGigantamaxLikely"))

        def _is_dynamax_only(p: dict) -> bool:
            if not isinstance(p, dict):
                return False
            if _is_gigantamax(p):
                return False
            dyn = p.get("dynamax")
            if isinstance(dyn, dict):
                return len(dyn.keys()) > 0
            if isinstance(dyn, bool):
                return dyn
            return False

        # Apply advanced search filter
        if search:
            print(f"[DEBUG] Applying search filter: {search}")
            data = apply_search_filter(data, search)
            print(f"[DEBUG] After filter: {len(data)} pokemon")

        # Apply unique filter if requested
        if unique_only:
            print("[DEBUG] Applying unique filter")
            data = filter_unique_pokemon(data)
            print(f"[DEBUG] After unique filter: {len(data)} pokemon")

        # Optional explicit Dynamax/Gigantamax filtering.
        # - gigantamax=true => only Gigantamax
        # - dynamax=true => only Dynamax (excluding Gigantamax)
        # - both true => any Max (union)
        if dynamax_only or gigantamax_only:
            if dynamax_only and gigantamax_only:
                data = [p for p in data if _is_dynamax_only(p) or _is_gigantamax(p)]
            elif gigantamax_only:
                data = [p for p in data if _is_gigantamax(p)]
            else:
                data = [p for p in data if _is_dynamax_only(p)]
            print(
                f"[DEBUG] After max filter (dynamax={dynamax_only}, gigantamax={gigantamax_only}): {len(data)} pokemon"
            )

        # Apply PVP filter if requested (Best Teams implies PVP)
        if best_teams_enabled:
            pvp_enabled = True

        if pvp_enabled:
            if pvp_league not in PVP_LEAGUE_CAPS:
                pvp_league = "GL"
            filtered = []
            for p in data:
                if pvp_match_and_annotate(
                    p,
                    pvp_league,
                    category=pvp_category,
                    threshold=2,
                    top_n=10,
                ):
                    filtered.append(p)
            data = filtered
            print(f"[DEBUG] After PVP filter ({pvp_league}): {len(data)} pokemon")

            # In PVP mode we sort primarily by meta rank (lower is better).
            # Tie-break using how close the IVs are to the nearest top-10 spread.
            def _pvp_rank(v):
                try:
                    return int(v)
                except Exception:
                    return 999999

            data.sort(
                key=lambda p: (
                    _pvp_rank(p.get("pvp_meta_rank")),
                    p.get("pvp_rank_top10", 999),
                    p.get("pvp_distance_max", 999),
                    p.get("pvp_distance_sum", 9999),
                    p.get("number", 0),
                )
            )

        # Apply sorting
        reverse = order_dir == "desc"

        # If PVP is enabled, we've already applied our dedicated sort above.
        if pvp_enabled:
            reverse = False
            order_by = "number"

        # Define sort key functions for different fields
        def get_sort_key(pokemon):
            if order_by == "number":
                return pokemon.get("number", 0)
            elif order_by == "name":
                return pokemon.get("name", "").lower()
            elif order_by == "cp":
                return pokemon.get("cp", 0)
            elif order_by == "captured":
                # SpeedUnlocker capture time is usually source.creationTimeMs (ms since epoch).
                # Fallback to legacy id if it looks like a timestamp.
                try:
                    src = pokemon.get("source")
                    if isinstance(src, dict):
                        v = src.get("creationTimeMs")
                        if v is not None:
                            return int(v)
                except Exception:
                    pass

                # Some records may surface it directly.
                for k in ("creationTimeMs", "captureTimeMs", "captured_at_ms"):
                    try:
                        v = pokemon.get(k)
                        if v is not None:
                            return int(v)
                    except Exception:
                        continue

                # If our SpeedUnlocker mapping used id=creationTimeMs, use that.
                try:
                    pid = str(pokemon.get("id") or "")
                    if pid.isdigit() and len(pid) >= 12:
                        return int(pid)
                except Exception:
                    pass

                return 0
            elif order_by == "height":
                return pokemon.get("height", 0)
            elif order_by == "weight":
                return pokemon.get("weight", 0)
            elif order_by == "iv":
                return pokemon.get("iv", 0)
            elif order_by == "attack":
                return pokemon.get("attack", 0)
            elif order_by == "defense":
                return pokemon.get("defence", 0)
            elif order_by == "stamina":
                return pokemon.get("stamina", 0)
            return 0

        if not pvp_enabled:
            data.sort(key=get_sort_key, reverse=reverse)

        # Recompute image paths on read to keep them consistent with the current
        # filename-generation rules (avoids needing to re-enrich old uploads).
        for p in data:
            try:
                if _is_false_positive_gigantamax_record(p):
                    # Repair previously-enriched false positives so we don't emit
                    # *_GIGANTAMAX sprites for crowned Zacian/Zamazenta.
                    p["gigantamax"] = False
                    if isinstance(p.get("form"), str) and "GIGANTAMAX" in p.get(
                        "form", ""
                    ):
                        p["form"] = p["form"].replace("_GIGANTAMAX", "")
                p["image"] = get_image_path(p)
            except Exception:
                # Keep whatever is already present if something unexpected happens
                pass

        # Get file metadata
        original_path = os.path.join(user_dir, f"{file_id}.json")
        file_metadata = None

        if os.path.exists(original_path):
            stat = os.stat(original_path)
            meta = _read_meta(file_id) if _is_uuid(file_id) else {}
            original_filename = meta.get("original_filename") if meta else None
            if not original_filename:
                original_filename = f"{file_id}.json"

            user, date = extract_metadata_from_filename(original_filename)
            file_metadata = {
                "id": file_id,
                "filename": original_filename,
                "user": user,
                "date": date,
                "upload_date": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "size": stat.st_size,
                "total_pokemon": len(data),
            }

        if best_teams_enabled:
            teams = compute_best_teams(data, pvp_league, pvp_category, max_teams=3)
            return jsonify(
                {
                    "metadata": file_metadata,
                    "pokemon": [],
                    "teams": teams,
                    "best_teams": {
                        "league": pvp_league,
                        "category": pvp_category,
                        "pool_size": len(data),
                    },
                }
            )

        return jsonify({"metadata": file_metadata, "pokemon": data})

    except Exception as e:
        return jsonify({"error": f"Error loading file: {str(e)}"}), 500


# Serve React App (for production only)
# In development, frontend runs on its own server (port 3000)
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve(path):
    # Don't intercept API routes
    if path.startswith("api/"):
        return jsonify({"error": "Not found"}), 404

    # Serve static files if they exist
    if (
        path != ""
        and app.static_folder
        and os.path.exists(os.path.join(app.static_folder, path))
    ):
        return send_from_directory(app.static_folder, path)

    # Serve index.html for SPA routing (production only)
    if app.static_folder and os.path.exists(
        os.path.join(app.static_folder, "index.html")
    ):
        return send_from_directory(app.static_folder, "index.html")

    return jsonify(
        {"message": "Frontend not built. Run 'npm run build' in frontend directory."}
    ), 404


if __name__ == "__main__":
    print("🚀 Starting Flask API...")
    print("📁 Files directory: ./files")
    print("📊 Data directory: ./data")
    print("📂 Uploads directory: ./uploads")
    print("🔥 Hot reload enabled")
    print("🌐 CORS enabled for localhost:3000")
    app.run(host="0.0.0.0", port=5001, debug=True)
