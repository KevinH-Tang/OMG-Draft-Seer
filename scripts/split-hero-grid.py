"""Split the hero cards from the supplied Dota 2 attribute grid screenshot."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


CARD_WIDTH = 66
CARD_HEIGHT = 115
ROW_Y = [46, 173, 300, 427, 554, 681]

# The final row of some attribute groups is intentionally shorter.
GROUPS = {
    "strength": ([51, 129, 207, 285, 363, 441], [6, 6, 6, 6, 6, 6]),
    "agility": ([543, 621, 699, 777, 855, 933], [6, 6, 6, 6, 6, 5]),
    "intelligence": ([1035, 1113, 1191, 1269, 1347, 1425], [6, 6, 6, 6, 6, 4]),
    "universal": ([1527, 1605, 1683, 1761], [4, 4, 4, 4, 4, 2]),
}


def split_grid(source: Path, output_dir: Path) -> list[dict[str, object]]:
    with Image.open(source) as image:
        if image.width < 1883 or image.height < 796:
            raise ValueError(f"source image is too small: {image.size}")

        output_dir.mkdir(parents=True, exist_ok=True)
        entries: list[dict[str, object]] = []
        sequence = 1

        for group, (x_positions, row_counts) in GROUPS.items():
            for row_index, count in enumerate(row_counts, start=1):
                y = ROW_Y[row_index - 1]
                for column_index, x in enumerate(x_positions[:count], start=1):
                    filename = f"hero_{sequence:03d}_{group}_r{row_index:02d}_c{column_index:02d}.png"
                    destination = output_dir / filename
                    image.crop((x, y, x + CARD_WIDTH, y + CARD_HEIGHT)).save(
                        destination, format="PNG", optimize=True
                    )
                    entries.append(
                        {
                            "index": sequence,
                            "group": group,
                            "row": row_index,
                            "column": column_index,
                            "box": {"x": x, "y": y, "width": CARD_WIDTH, "height": CARD_HEIGHT},
                            "file": filename,
                        }
                    )
                    sequence += 1

    manifest = {
        "source": str(source),
        "image_size": [image.width, image.height],
        "card_size": [CARD_WIDTH, CARD_HEIGHT],
        "count": len(entries),
        "entries": entries,
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=True, indent=2), encoding="utf-8"
    )
    return entries


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()

    entries = split_grid(args.source, args.output_dir)
    print(f"exported {len(entries)} hero cards to {args.output_dir}")


if __name__ == "__main__":
    main()
