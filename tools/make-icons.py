#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成彩智云端版 PWA 图标：python3 tools/make-icons.py"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'icons')
FONT = '/System/Library/Fonts/STHeiti Medium.ttc'
SIZE = 1024


def gradient(w, h, top, bottom):
    base = Image.new('RGB', (1, h))
    px = base.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return base.resize((w, h), Image.BILINEAR)


def glow(size, cx, cy, radius, color, strength=150):
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    steps = 24
    for i in range(steps, 0, -1):
        r = int(radius * i / steps)
        a = int(strength * (1 - i / steps) ** 2)
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color + (a,))
    return layer.filter(ImageFilter.GaussianBlur(radius * 0.17))


def rounded_mask(size, radius):
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def build(size, radius, content_scale=1.0, full_bleed=False):
    bg = gradient(size, size, (22, 32, 54), (6, 10, 20)).convert('RGBA')
    bg.alpha_composite(glow(size, int(size * 0.12), int(size * 0.08), int(size * 0.78), (255, 91, 110), 135))
    bg.alpha_composite(glow(size, int(size * 0.94), int(size * 0.9), int(size * 0.7), (78, 161, 255), 110))
    bg.alpha_composite(glow(size, int(size * 0.5), int(size * 0.45), int(size * 0.55), (255, 204, 102), 30))

    content = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    font = ImageFont.truetype(FONT, int(size * 0.56))
    text = '彩'
    bbox = font.getbbox(text)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (size - tw) // 2 - bbox[0]
    ty = (size - th) // 2 - bbox[1] - int(size * 0.01)

    shadow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((tx, ty + int(size * 0.02)), text, font=font, fill=(0, 0, 0, 150))
    content.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(int(size * 0.03))))

    text_mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(text_mask).text((tx, ty), text, font=font, fill=255)
    gold = gradient(size, size, (255, 244, 208), (255, 175, 70)).convert('RGBA')
    gold.putalpha(text_mask)
    content.alpha_composite(gold)

    d = ImageDraw.Draw(content)
    r = int(size * 0.036)
    gap = int(size * 0.115)
    cy = int(size * 0.8)
    for i, color in enumerate([(240, 67, 91), (255, 204, 102), (78, 161, 255)]):
        cx = int(size / 2 + (i - 1) * gap)
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color + (255,))

    if content_scale != 1.0:
        inner = int(size * content_scale)
        scaled = content.resize((inner, inner), Image.LANCZOS)
        canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        canvas.alpha_composite(scaled, ((size - inner) // 2, (size - inner) // 2))
        content = canvas

    bg.alpha_composite(content)
    if not full_bleed:
        bg.putalpha(rounded_mask(size, radius))
    return bg


def save(img, name, size):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), 'PNG')
    print('  ✓', name, str(size))


def main():
    os.makedirs(OUT, exist_ok=True)
    print('生成彩智云端版图标...')
    icon = build(SIZE, int(SIZE * 0.22))
    save(icon, 'icon-192.png', 192)
    save(icon, 'icon-512.png', 512)
    save(icon, 'apple-touch-icon.png', 180)
    save(icon, 'favicon-32.png', 32)
    save(build(SIZE, 0, 0.72, full_bleed=True), 'icon-maskable-512.png', 512)


if __name__ == '__main__':
    main()
