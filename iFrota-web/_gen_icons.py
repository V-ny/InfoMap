"""Gera os ícones PWA do IFrota (verde com marcador de mapa).
Uso: python _gen_icons.py  → escreve em icons/
"""
import os
from PIL import Image, ImageDraw

os.makedirs("icons", exist_ok=True)

GRAD_TOP = (67, 160, 71)    # #43a047
GRAD_BOT = (27, 94, 32)     # #1b5e20
WHITE = (255, 255, 255)


def vgrad(size, top, bot):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        px_row = (
            int(top[0] + (bot[0] - top[0]) * t),
            int(top[1] + (bot[1] - top[1]) * t),
            int(top[2] + (bot[2] - top[2]) * t),
        )
        for x in range(size):
            px[x, y] = px_row
    return img


def draw_pin(draw, cx, cy, r, color):
    """Marcador estilo 'map pin': círculo + ponta inferior."""
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
    # ponta triangular
    draw.polygon([(cx - r * 0.55, cy + r * 0.45),
                  (cx + r * 0.55, cy + r * 0.45),
                  (cx, cy + r * 1.7)], fill=color)
    # furo interno
    ir = r * 0.42
    draw.ellipse([cx - ir, cy - ir, cx + ir, cy + ir], fill=None, outline=None)


def make(size, maskable=False):
    img = vgrad(size, GRAD_TOP, GRAD_BOT).convert("RGBA")
    d = ImageDraw.Draw(img)
    # Padding extra pra maskable (safe zone ~80%)
    scale = 0.56 if maskable else 0.66
    r = int(size * 0.18 * (scale / 0.66))
    cx, cy = size // 2, int(size * 0.44)
    draw_pin(d, cx, cy, r, WHITE)
    # buraco no meio do pin (verde do fundo)
    ir = int(r * 0.40)
    grad_mid = tuple(int((GRAD_TOP[i] + GRAD_BOT[i]) / 2) for i in range(3))
    d.ellipse([cx - ir, cy - ir, cx + ir, cy + ir], fill=grad_mid + (255,))
    return img


for s in (192, 512):
    make(s).save(f"icons/icon-{s}.png")
    make(s, maskable=True).save(f"icons/icon-{s}-maskable.png")

# Favicon pequeno
make(64).save("icons/favicon.png")
print("Ícones gerados em icons/")
