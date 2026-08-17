# -*- coding: utf-8 -*-
"""Подготовка растровых ассетов меню: чистка, апскейл, резкость.

    python3 tools/images/enhance.py bg   <исходник> --out src/assets/menubg.webp
    python3 tools/images/enhance.py logo <исходник> --out src/assets/menulogo.webp

Исходники в репозиторий не кладутся — сюда приходят уже готовые картинки, а
скрипт доводит их до размера и чистоты, пригодных для полноэкранного фона и
для логотипа, который тянется под любой масштаб интерфейса.

Два режима отличаются задачами:

* `bg`   — тёмный кадр рубки. Главная беда таких картинок — шум в тенях,
           который после апскейла превращается в кашу. Поэтому сначала
           шумодав по маске теней, потом Ланцош, потом аккуратный аншарп.
* `logo` — картинка с альфой. Мягкая полупрозрачная маска даёт «снег» по
           контуру, а чёрный цвет в прозрачных пикселях — тёмную кайму.
           Лечится растеканием цвета наружу и ужесточением альфы.
"""
import argparse
import os

import numpy as np
from PIL import Image, ImageFilter


# --- общие помощники --------------------------------------------------------

def to_float(im: Image.Image) -> np.ndarray:
    return np.asarray(im, dtype=np.float32) / 255.0


def to_image(arr: np.ndarray, mode: str) -> Image.Image:
    return Image.fromarray(np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8), mode)


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def luma(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def resize_linear(im: Image.Image, size) -> Image.Image:
    """Апскейл в линейном свете: по гамме Ланцош тянет тёмные края в грязь."""
    has_a = im.mode == 'RGBA'
    arr = to_float(im)
    rgb = srgb_to_linear(arr[..., :3])
    src = np.concatenate([rgb, arr[..., 3:4]], axis=2) if has_a else rgb
    # PIL не ресайзит многоканальный float — тянем поканально в режиме 'F'.
    out = []
    for c in range(src.shape[2]):
        ch = Image.fromarray(src[..., c], mode='F').resize(size, Image.LANCZOS)
        out.append(np.asarray(ch, dtype=np.float32))
    res = np.stack(out, axis=2)
    rgb_s = linear_to_srgb(res[..., :3])
    if has_a:
        return to_image(np.concatenate([rgb_s, np.clip(res[..., 3:4], 0, 1)], axis=2), 'RGBA')
    return to_image(rgb_s, 'RGB')


def unsharp(im: Image.Image, radius=1.7, percent=58, threshold=3) -> Image.Image:
    """Аншарп по RGB; альфу трогать нельзя — она и так вычищена вручную."""
    if im.mode != 'RGBA':
        return im.filter(ImageFilter.UnsharpMask(radius, percent, threshold))
    r, g, b, a = im.split()
    rgb = Image.merge('RGB', (r, g, b)).filter(ImageFilter.UnsharpMask(radius, percent, threshold))
    return Image.merge('RGBA', (*rgb.split(), a))


# --- режим bg ---------------------------------------------------------------

def denoise_shadows(im: Image.Image, strength=0.75, knee=0.22) -> Image.Image:
    """Размывает только тени: там сидит компрессионный шум, а детали — в светах.

    Маска строится по яркости, поэтому голограмма и лампы остаются острыми,
    а плоские тёмные стены очищаются.
    """
    arr = to_float(im)
    blur = to_float(im.filter(ImageFilter.GaussianBlur(1.1)))
    l = luma(arr)
    # 1 в глубоких тенях, 0 к средним тонам
    m = np.clip(1.0 - l / knee, 0.0, 1.0) ** 1.4 * strength
    out = arr * (1 - m[..., None]) + blur * m[..., None]
    return to_image(out, im.mode)


def grade(im: Image.Image, contrast=1.055, saturation=1.08, lift=-0.006) -> Image.Image:
    """Лёгкая цветокоррекция: S-кривая по яркости и чуть больше цвета."""
    arr = to_float(im)
    lin = srgb_to_linear(arr)
    # S-кривая вокруг средне-серого
    pivot = 0.18
    lin = pivot * np.power(np.maximum(lin / pivot, 1e-6), contrast)
    out = linear_to_srgb(lin) + lift
    l = luma(out)[..., None]
    out = l + (out - l) * saturation
    return to_image(np.clip(out, 0, 1), im.mode)


def do_bg(src: str, out: str, width: int, height: int) -> None:
    im = Image.open(src).convert('RGB')
    im = denoise_shadows(im)
    im = resize_linear(im, (width, height))
    im = unsharp(im, radius=1.9, percent=62, threshold=3)
    im = grade(im)
    save(im, out, quality=92)


# --- режим logo -------------------------------------------------------------

def bleed_color(arr: np.ndarray, rounds=6) -> np.ndarray:
    """Растекание цвета в прозрачные пиксели.

    В прозрачных областях PNG обычно лежит чёрный. При масштабировании он
    подмешивается в полупрозрачную кромку, и вокруг знака появляется тёмная
    кайма. Здесь цвет итеративно расползается наружу с весом альфы, поэтому
    кромка получает цвет соседнего непрозрачного пикселя, а не фон.
    """
    rgb = arr[..., :3].copy()
    a = arr[..., 3].copy()
    w = a.copy()
    for _ in range(rounds):
        num = np.zeros_like(rgb)
        den = np.zeros_like(w)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            sr = np.roll(np.roll(rgb, dy, axis=0), dx, axis=1)
            sw = np.roll(np.roll(w, dy, axis=0), dx, axis=1)
            num += sr * sw[..., None]
            den += sw
        filled = np.where(den[..., None] > 1e-5, num / np.maximum(den[..., None], 1e-5), rgb)
        gap = (w < 0.999)[..., None]
        rgb = np.where(gap, rgb * w[..., None] + filled * (1 - w[..., None]), rgb)
        w = np.clip(np.maximum(w, np.where(den > 1e-5, 1.0, 0.0) * 0.55), 0, 1)
    return np.concatenate([rgb, a[..., None]], axis=2)


def firm_alpha(a: np.ndarray, lo=0.10, hi=0.58) -> np.ndarray:
    """Ужесточает вялую маску, сохраняя сглаживание на самой кромке.

    Всё, что ниже `lo`, уходит в прозрачность (это и есть «снег» вокруг
    знака), всё выше `hi` становится плотным, между ними — сглаженный
    переход шириной в пару пикселей.
    """
    t = np.clip((a - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def do_logo(src: str, out: str, width: int) -> None:
    im = Image.open(src).convert('RGBA')
    arr = to_float(im)
    arr[..., 3] = firm_alpha(arr[..., 3])
    arr = bleed_color(arr)

    # Обрезка по содержимому с небольшим полем — знак не должен «плавать».
    ys, xs = np.where(arr[..., 3] > 0.02)
    pad = 6
    y0, y1 = max(0, ys.min() - pad), min(arr.shape[0], ys.max() + 1 + pad)
    x0, x1 = max(0, xs.min() - pad), min(arr.shape[1], xs.max() + 1 + pad)
    arr = arr[y0:y1, x0:x1]

    im = to_image(arr, 'RGBA')
    height = max(1, round(im.height * width / im.width))
    im = resize_linear(im, (width, height))
    im = unsharp(im, radius=1.4, percent=70, threshold=2)
    save(im, out, quality=95)


# --- вывод ------------------------------------------------------------------

def save(im: Image.Image, out: str, quality: int) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    ext = os.path.splitext(out)[1].lower()
    if ext == '.webp':
        im.save(out, 'WEBP', quality=quality, method=6)
    elif ext in ('.jpg', '.jpeg'):
        im.convert('RGB').save(out, 'JPEG', quality=quality, subsampling=0, optimize=True)
    else:
        im.save(out, optimize=True)
    print(f'[enhance] {out}  {im.width}x{im.height}  {os.path.getsize(out) / 1024:.0f} KB')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('mode', choices=('bg', 'logo'))
    ap.add_argument('src')
    ap.add_argument('--out', required=True)
    ap.add_argument('--width', type=int)
    ap.add_argument('--height', type=int)
    args = ap.parse_args()
    if args.mode == 'bg':
        do_bg(args.src, args.out, args.width or 2560, args.height or 1440)
    else:
        do_logo(args.src, args.out, args.width or 1400)


if __name__ == '__main__':
    main()
