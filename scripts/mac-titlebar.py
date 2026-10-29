"""Checks a screenshot of Shoji on macOS: the window buttons must sit centred in its title bar.

Usage: python3 scripts/mac-titlebar.py <screenshot.png>

It finds the red close button, then walks up and down from beside it to the window's top edge and
the title bar's bottom border. The title bar is 42 points tall, which gives the screenshot's scale.
Results go out as GitHub annotations, with a small crop of the title bar to look at.
"""

import base64
import io
import sys

from PIL import Image

TITLE_BAR = 42  # points, as shell.css draws it
TOLERANCE = 1.5  # points either way


def close(a, b, by=18):
    return all(abs(x - y) <= by for x, y in zip(a, b))


def main(path):
    shot = Image.open(path).convert("RGB")
    w, h = shot.size
    px = shot.load()

    # The close button: macOS draws it in #ff5f57, a little lighter or darker at its edge.
    reds = [(x, y) for y in range(h // 3) for x in range(w // 2) if close(px[x, y], (255, 95, 87), 30)]
    if not reds:
        print("::error::No red close button in the screenshot. Was Shoji in front?")
        return 1
    left, right = min(x for x, _ in reds), max(x for x, _ in reds)
    top, bottom = min(y for _, y in reds), max(y for _, y in reds)
    cy = (top + bottom) / 2

    # Beside the buttons is plain title bar. Walk up to the window's edge and down to its border.
    x = right + 60
    bar = px[x, int(cy)]
    edge = int(cy)
    while edge > 0 and close(px[x, edge - 1], bar, 6):
        edge -= 1
    border = int(cy)
    while border < h - 1 and close(px[x, border + 1], bar, 6):
        border += 1
    border += 1
    scale = (border - edge) / TITLE_BAR
    centre = (cy - edge) / scale
    size = (bottom - top + 1) / scale

    print(
        f"::notice title=Measured::window top {edge}px, border {border}px, scale {scale:.2f}; "
        f"button {size:.1f}pt tall, centred {centre:.1f}pt down (want {TITLE_BAR / 2}pt), "
        f"left edge {(left - 0) / scale:.1f}pt into the screen"
    )

    crop = shot.crop((max(0, left - 40), max(0, edge - 6), min(w, left + 420), min(h, border + 8)))
    crop = crop.quantize(colors=32)
    buf = io.BytesIO()
    crop.save(buf, format="PNG", optimize=True)
    data = base64.b64encode(buf.getvalue()).decode()
    chunks = [data[i : i + 3800] for i in range(0, len(data), 3800)]
    for i, chunk in enumerate(chunks):
        print(f"::notice title=Crop {i + 1} of {len(chunks)}::{chunk}")

    if abs(centre - TITLE_BAR / 2) > TOLERANCE:
        print(f"::error::The window buttons are centred {centre:.1f}pt down a {TITLE_BAR}pt title bar.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
