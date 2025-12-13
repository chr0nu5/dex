"""
download_location_cards.py
~~~~~~~~~~~~~~~~~~~~~~~~~~

This script reads a JSON file mapping Pokémon GO location card strings
to their corresponding image URLs and downloads each image. Each image
is saved with the same base name as the original string (e.g.
``LocationCard_Lc2023LasvegasGotour001``) and retains the original
file extension from the URL (``.jpg``, ``.png``, etc.). Entries with
empty or missing URLs are skipped. Failed downloads (due to HTTP
errors or other issues) are reported but do not halt the overall
process.

Usage:
    python3 download_location_cards.py --mapping-file path/to/mapping.json --output-dir path/to/save/images

If you omit ``--mapping-file``, the script defaults to
``location_card_mapping.json`` in the current directory. The default
output directory is ``location_card_images``.

Dependencies:
    - requests

Example:
    python3 download_location_cards.py \
        --mapping-file /home/oai/share/location_card_mapping.json \
        --output-dir /home/oai/share/downloaded_cards
"""

import argparse
import json
import os
from urllib.parse import urlparse

import requests


def _already_downloaded(name: str, output_dir: str) -> str | None:
    """Return the existing filepath if a file for this base name already exists."""
    if not name:
        return None
    # Common extensions we might encounter.
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        p = os.path.join(output_dir, f"{name}{ext}")
        if os.path.exists(p):
            return p
    return None


def download_image(name: str, url: str, output_dir: str) -> bool:
    """Download a single image from the given URL and save it with the
    provided base name in the specified output directory.

    Args:
        name: The base filename (without extension) to use when saving
              the downloaded image.
        url: The URL of the image to download.
        output_dir: The directory where the image should be saved.

    Returns:
        True if the download succeeded, False otherwise.
    """
    if not url:
        # Skip empty URLs
        print(f"[SKIP] No URL for {name}")
        return False

    existing = _already_downloaded(name, output_dir)
    if existing:
        print(f"[SKIP] Already downloaded: {os.path.basename(existing)}")
        return False

    # Determine the file extension from the URL path; default to .jpg
    parsed = urlparse(url)
    path = parsed.path
    _, ext = os.path.splitext(path)
    if not ext:
        ext = ".jpg"

    filename = f"{name}{ext}"
    filepath = os.path.join(output_dir, filename)

    # If the URL implies a specific extension, avoid downloading if that exact file now exists.
    if os.path.exists(filepath):
        print(f"[SKIP] Already downloaded: {filename}")
        return False

    try:
        response = requests.get(url, stream=True, timeout=30)
        response.raise_for_status()
    except requests.RequestException as e:
        print(f"[ERROR] Failed to download {name} from {url}: {e}")
        return False

    try:
        with open(filepath, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:  # filter out keep-alive new chunks
                    f.write(chunk)
        print(f"[OK] Saved {filename}")
        return True
    except OSError as e:
        print(f"[ERROR] Could not write file {filepath}: {e}")
        return False


def main() -> None:
    script_dir = os.path.dirname(os.path.abspath(__file__))

    parser = argparse.ArgumentParser(
        description="Download Pokémon GO location card images based on a JSON mapping."
    )
    parser.add_argument(
        "--mapping-file",
        default="location_card_mapping.json",
        help="Path to the JSON file containing string-to-URL mappings. Defaults to location_card_mapping.json next to this script.",
    )
    parser.add_argument(
        "--output-dir",
        default="location",
        help="Directory where downloaded images will be stored. Defaults to ./location next to this script.",
    )
    args = parser.parse_args()

    # Resolve defaults/relative paths relative to this script's directory,
    # so running the script from other working directories still works.
    mapping_path = args.mapping_file
    if not os.path.isabs(mapping_path):
        mapping_path = os.path.join(script_dir, mapping_path)

    output_dir = args.output_dir
    if not os.path.isabs(output_dir):
        output_dir = os.path.join(script_dir, output_dir)

    # Load the mapping
    try:
        with open(mapping_path, "r", encoding="utf-8") as f:
            mapping = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        raise SystemExit(f"Failed to read mapping file {mapping_path}: {e}")

    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)

    # Iterate over mapping and download each image
    total = len(mapping)
    success_count = 0
    skip_count = 0
    for name, url in mapping.items():
        if not url:
            skip_count += 1
            print(f"[SKIP] No URL for {name}")
            continue
        if download_image(name, url, output_dir):
            success_count += 1

    print("\nSummary:")
    print(f"Total entries: {total}")
    print(f"Successfully downloaded: {success_count}")
    print(f"Skipped (no URL): {skip_count}")
    print(f"Failed downloads: {total - success_count - skip_count}")


if __name__ == "__main__":
    main()
