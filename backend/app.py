import json
import os
import re
import unicodedata
import uuid
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder="../frontend/build")

# Configure CORS properly
CORS(
    app,
    resources={
        r"/api/*": {
            "origins": ["http://localhost:3000", "http://localhost:5000"],
            "methods": ["GET", "POST", "OPTIONS"],
            "allow_headers": ["Content-Type"],
            "supports_credentials": False,
        }
    },
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
    if not os.path.exists(META_PATH):
        print(f"⚠️  Warning: {META_PATH} not found. Enrichment will be limited.")
        return

    with open(META_PATH, encoding="utf-8") as f:
        raw_data = json.load(f)

    for item in raw_data:
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


load_meta_map()

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
    name = p.get("name", "").upper()
    form = p.get("form")
    costume = p.get("costume")
    gender = p.get("gender", "").upper()
    shiny = p.get("shiny", False)
    height_label = p.get("height_label", "").upper()

    # APEX forms special handling (must return early with shiny if needed)
    if form == "LUGIA_S":
        if shiny:
            return "img/assets/pm249.fS.s.icon.png"
        return "img/assets/pm249.fS.icon.png"
    elif form == "HO_OH_S":
        if shiny:
            return "img/assets/pm250.fS.s.icon.png"
        return "img/assets/pm250.fS.icon.png"

    image_name = f"pm{number}"
    form_part = form.replace(f"{name}_", "") if form else ""

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
            form_part = "_".join(parts[2:])
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
    """Extract user and date from filename like 'Pokemons-LioAndLiz-18-11-2025.json'"""
    pattern = r"Pokemons-([^-]+)-(\d{2}-\d{2}-\d{4})\.json"
    match = re.match(pattern, filename)
    if match:
        user = match.group(1)
        date_str = match.group(2)
        try:
            date_obj = datetime.strptime(date_str, "%d-%m-%Y")
            return user, date_obj.isoformat()
        except:
            pass
    return None, None


def get_user_files_metadata(user_id):
    """Get list of files for a user"""
    uploads_dir = os.path.join(os.path.dirname(__file__), "uploads", user_id)
    if not os.path.exists(uploads_dir):
        return []

    files = []
    for filename in os.listdir(uploads_dir):
        if filename.endswith("_enriched.json"):
            continue
        if not filename.endswith(".json"):
            continue

        filepath = os.path.join(uploads_dir, filename)
        enriched_path = filepath.replace(".json", "_enriched.json")

        stat = os.stat(filepath)
        user, date = extract_metadata_from_filename(filename)

        files.append(
            {
                "id": filename.replace(".json", ""),
                "filename": filename,
                "user": user,
                "date": date,
                "upload_date": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "size": stat.st_size,
                "enriched": os.path.exists(enriched_path),
            }
        )

    return sorted(files, key=lambda x: x["upload_date"], reverse=True)


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
    p = {k.replace("mon_", ""): v for k, v in raw_data.items()}

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

    # Save original file
    filepath = os.path.join(user_dir, file.filename)
    file.save(filepath)

    # Parse and enrich
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            raw_data = json.load(f)

        if not isinstance(raw_data, dict):
            return jsonify({"error": "Invalid JSON format. Expected an object"}), 400

        # Track progress
        file_id = file.filename.replace(".json", "")
        total = len(raw_data)
        ENRICHMENT_PROGRESS[file_id] = {
            "current": 0,
            "total": total,
            "status": "processing",
        }

        enriched_data = []
        for idx, (pokemon_id, pokemon) in enumerate(raw_data.items()):
            pokemon["id"] = pokemon_id
            enriched = enrich_pokemon(pokemon)
            enriched_data.append(enriched)
            ENRICHMENT_PROGRESS[file_id]["current"] = idx + 1

        # Save enriched file
        enriched_path = filepath.replace(".json", "_enriched.json")
        with open(enriched_path, "w", encoding="utf-8") as f:
            json.dump(enriched_data, f, indent=2)

        ENRICHMENT_PROGRESS[file_id]["status"] = "completed"

        user, date = extract_metadata_from_filename(file.filename)

        return jsonify(
            {
                "message": "File uploaded and enriched successfully",
                "file_id": file_id,
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
            match = pokemon.get(search_query, False) == True

        elif search_query in ["legendary", "mythical"]:
            match = pokemon.get(search_query, False) == True

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


@app.route("/api/file/<user_id>/<file_id>", methods=["GET"])
def get_file_data(user_id, file_id):
    """Get enriched Pokemon data for a specific file with optional filtering and sorting"""
    # Try to find the enriched file
    user_dir = os.path.join(os.path.dirname(__file__), "uploads", user_id)

    if not os.path.exists(user_dir):
        return jsonify({"error": "User directory not found"}), 404

    # Look for the enriched file
    enriched_path = os.path.join(user_dir, f"{file_id}_enriched.json")

    if not os.path.exists(enriched_path):
        return jsonify({"error": "Enriched file not found"}), 404

    try:
        with open(enriched_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        # Get query parameters for filtering and sorting
        search = request.args.get("search", "").lower()
        order_by = request.args.get("order_by", "number")
        order_dir = request.args.get("order_dir", "asc")

        # Apply advanced search filter
        if search:
            data = apply_search_filter(data, search)

        # Apply sorting
        reverse = order_dir == "desc"

        # Define sort key functions for different fields
        def get_sort_key(pokemon):
            if order_by == "number":
                return pokemon.get("number", 0)
            elif order_by == "name":
                return pokemon.get("name", "").lower()
            elif order_by == "cp":
                return pokemon.get("cp", 0)
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

        data.sort(key=get_sort_key, reverse=reverse)

        # Get file metadata
        original_path = os.path.join(user_dir, f"{file_id}.json")
        file_metadata = None

        if os.path.exists(original_path):
            stat = os.stat(original_path)
            user, date = extract_metadata_from_filename(f"{file_id}.json")
            file_metadata = {
                "id": file_id,
                "filename": f"{file_id}.json",
                "user": user,
                "date": date,
                "upload_date": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "size": stat.st_size,
                "total_pokemon": len(data),
            }

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
    app.run(host="0.0.0.0", port=5000, debug=True)
