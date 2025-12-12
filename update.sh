#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="https://raw.githubusercontent.com/pvpoke/pvpoke/refs/heads/master/src/data/rankings/all"

RANKING_FILES=()
while IFS= read -r f; do
  RANKING_FILES+=("$f")
done < <(find "$ROOT_DIR/backend/data" -type f -name 'rankings-*.json' | sort)

if [[ ${#RANKING_FILES[@]} -eq 0 ]]; then
  echo "No rankings files found under backend/data"
  exit 0
fi

echo "Updating ${#RANKING_FILES[@]} ranking files from PvPoke..."

for dest in "${RANKING_FILES[@]}"; do
  rel="${dest#"$ROOT_DIR/backend/data/"}"
  filename="$(basename "$dest")"

  category="overall"
  if [[ "$rel" == pvp/*/* ]]; then
    category="${rel#pvp/}"
    category="${category%%/*}"
  fi

  url="$BASE_URL/$category/$filename"

  tmp="$(mktemp)"
  echo "- $category/$filename"

  if ! curl -fsSL "$url" -o "$tmp"; then
    echo "Failed to download: $url" >&2
    rm -f "$tmp"
    exit 1
  fi

  mv "$tmp" "$dest"
done

echo "Done."
