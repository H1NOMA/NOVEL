# -*- coding: utf-8 -*-
"""Кузница иконок: 3D-бюсты наземных подразделений и супероружия (Blender/Cycles).

Запуск:  python3 tools/blender/unitforge.py --out src/assets/units [--only helldivers]

Каждое подразделение — небольшая скульптура из примитивов (шлем, корпус, жвалы,
силуэт машины), снятая в три четверти на прозрачном фоне с фракционным
контровым светом. Результат — квадратные WEBP с альфой для карточек сил;
рисуются в интерфейсе так же, как силуэт эсминца во флотских карточках.

Оси как в shipforge: X — ширина, Y — «вперёд» (к зрителю), Z — вверх.
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shipforge as sf  # noqa: E402

box, cyl, cone, sphere, torus, lumpy = sf.box, sf.cyl, sf.cone, sf.sphere, sf.torus, sf.lumpy

# ---------------------------------------------------------------------------
# Палитра. Базовые материалы задаются на каждую фракцию: броня, тёмный металл,
# «плоть», акцент (он же контровой свет) и свечение оптики.
# ---------------------------------------------------------------------------

PALETTES = {
    'superEarth': dict(
        armor=(0.78, 0.80, 0.83, 1), armorDark=(0.16, 0.18, 0.22, 1),
        flesh=(0.42, 0.34, 0.28, 1), accent=(1.00, 0.78, 0.06, 1), glow=(0.55, 0.82, 1.00, 1)),
    'automatons': dict(
        armor=(0.34, 0.35, 0.37, 1), armorDark=(0.10, 0.10, 0.11, 1),
        flesh=(0.22, 0.20, 0.19, 1), accent=(1.00, 0.20, 0.07, 1), glow=(1.00, 0.30, 0.10, 1)),
    'terminids': dict(
        armor=(0.52, 0.38, 0.15, 1), armorDark=(0.20, 0.14, 0.06, 1),
        flesh=(0.60, 0.50, 0.28, 1), accent=(1.00, 0.62, 0.10, 1), glow=(0.95, 0.75, 0.20, 1)),
    'illuminate': dict(
        armor=(0.74, 0.72, 0.82, 1), armorDark=(0.20, 0.17, 0.30, 1),
        flesh=(0.46, 0.40, 0.62, 1), accent=(0.62, 0.42, 1.00, 1), glow=(0.75, 0.55, 1.00, 1)),
    'superFederation': dict(
        armor=(0.62, 0.66, 0.66, 1), armorDark=(0.14, 0.18, 0.19, 1),
        flesh=(0.42, 0.34, 0.28, 1), accent=(0.20, 0.80, 0.72, 1), glow=(0.40, 0.95, 0.88, 1)),
}


def palette(faction: str) -> None:
    """Прописать материалы фракции в общий словарь shipforge."""
    p = PALETTES[faction]
    sf.MAT_SPECS['armor'] = dict(color=p['armor'], metallic=0.45, rough=0.45)
    sf.MAT_SPECS['armorDark'] = dict(color=p['armorDark'], metallic=0.55, rough=0.55)
    sf.MAT_SPECS['flesh'] = dict(color=p['flesh'], metallic=0.0, rough=0.75)
    sf.MAT_SPECS['accent'] = dict(color=p['accent'], metallic=0.3, rough=0.4,
                                  emit=1.5, emitc=p['accent'])
    sf.MAT_SPECS['glow'] = dict(color=p['glow'], metallic=0.0, rough=0.3,
                                emit=7.0, emitc=p['glow'])
    # тёмный/корпусный из shipforge переиспользуем как есть
    sf.MAT_SPECS['hull'] = dict(color=p['armor'], metallic=0.5, rough=0.45)
    sf.MAT_SPECS['dark'] = dict(color=p['armorDark'], metallic=0.6, rough=0.55)
    sf.MAT_SPECS['organic'] = dict(color=p['armor'], metallic=0.05, rough=0.8)
    sf.MAT_SPECS['organicDark'] = dict(color=p['armorDark'], metallic=0.05, rough=0.75)


# ---------------------------------------------------------------------------
# Общие детали
# ---------------------------------------------------------------------------

def shoulders(w=0.30, h=0.16, m='armor', z=-0.24, pads=True):
    """Плечевой пояс бюста. Детали зовутся bust_* — кадр их намеренно срезает."""
    box(w * 0.62, 0.15, h, m, (0, 0, z + 0.02), taper=0.9, bevel=0.014, name='bust_torso')
    if pads:
        for s in (-1, 1):
            p = sphere(0.085, m, (s * (w / 2 - 0.02), 0, z + h / 2),
                       scale=(1, 0.9, 0.62), seg=18, rings=12, name=f'bust_pad_{s}')
            p.rotation_euler.y = s * 0.42
    else:
        for s in (-1, 1):
            p = box(0.10, 0.13, 0.06, m, (s * (w / 2 - 0.03), 0, z + h / 2 - 0.01),
                    bevel=0.01, name=f'bust_pad_{s}')
            p.rotation_euler.y = s * 0.38
    # шея — единственное, что попадает в кадр снизу
    cyl(0.045, 0.05, 0.09, 'armorDark', (0, 0, z + h / 2 + 0.03), axis='Z', verts=12,
        name='neck')


def visor_slit(y=0.088, z=0.03, w=0.115, h=0.022, m='glow'):
    box(w, 0.02, h, m, (0, y, z), bevel=0.004, name='visor')


def helm(w, d, h, at=(0, 0, 0), m='armor', round_amt=0.045, taper=None, name='helm'):
    """Шлем — сильно скруглённая коробка. В отличие от сферы даёт плоские грани,
    на которые можно надёжно ставить визор, фильтры и гребни."""
    return box(w, d, h, m, at, bevel=round_amt, taper=taper, name=name)


def on_shell(center, radii, direction, out=1.02):
    """Точка на поверхности эллипсоида — чтобы деталь не тонула в голове."""
    d = Vector(direction).normalized()
    return (center[0] + d.x * radii[0] * out,
            center[1] + d.y * radii[1] * out,
            center[2] + d.z * radii[2] * out)


# ---------------------------------------------------------------------------
# Супер-Земля
# ---------------------------------------------------------------------------

def helldivers():
    """Адский десантник: закрытый шлем с горящим визором и дыхательным блоком."""
    shoulders(0.34, 0.16, 'armor', -0.25)
    # шлем-коробка со скруглением: плоское «лицо» смотрит прямо в кадр
    helm(0.20, 0.185, 0.20, (0, 0, 0.02), 'armor', 0.05, name='helm')
    # утопленная тёмная маска и горящий визор поверх неё
    box(0.165, 0.045, 0.085, 'armorDark', (0, 0.095, 0.035), bevel=0.01, name='mask')
    visor_slit(0.113, 0.038, 0.14, 0.030)
    # дыхательный блок и фильтры по щекам
    box(0.095, 0.075, 0.06, 'armorDark', (0, 0.085, -0.055), bevel=0.012, name='resp')
    for s in (-1, 1):
        cyl(0.026, 0.026, 0.045, 'armorDark', (s * 0.098, 0.05, -0.04), axis='X', verts=12,
            name=f'filter_{s}')
    # фракционный гребень вдоль макушки и антенна
    box(0.030, 0.20, 0.035, 'accent', (0, -0.005, 0.125), taper=0.5, bevel=0.008, name='crest')
    cyl(0.006, 0.004, 0.13, 'armorDark', (0.088, -0.06, 0.115), axis='Z', verts=8, name='ant')


def seaf():
    """ВССЗ: пехотная каска с полями, открытое лицо, ствол винтовки за плечом."""
    shoulders(0.30, 0.15, 'armor', -0.24, pads=False)
    # лицо — вынесено вперёд, каска садится сверху
    fc, fr = (0, 0.035, -0.03), (0.082, 0.092, 0.10)
    sphere(1.0, 'flesh', fc, scale=fr, seg=24, rings=16, name='face')
    for s in (-1, 1):
        sphere(0.013, 'armorDark', on_shell(fc, fr, (s * 0.42, 0.85, 0.30), 0.97),
               seg=10, rings=8, name=f'eye_{s}')
    box(0.055, 0.03, 0.02, 'armorDark', on_shell(fc, fr, (0, 0.9, -0.42), 0.9), bevel=0.004,
        name='mouth')
    # каска: купол + широкие поля
    sphere(1.0, 'armor', (0, 0.005, 0.045), scale=(0.108, 0.112, 0.078), seg=26, rings=18,
           name='helm')
    torus(0.118, 0.014, 'armor', (0, 0.005, 0.012), rot=(0.08, 0, 0), name='brim')
    torus(0.109, 0.008, 'armorDark', (0, 0.005, 0.035), name='band')
    # звезда на каске (спереди, поверх купола)
    box(0.05, 0.022, 0.05, 'accent', (0, 0.098, 0.055), rot=(0.35, 0.78, 0), bevel=0.004,
        name='star')
    # ствол винтовки из-за плеча
    r = box(0.026, 0.30, 0.026, 'armorDark', (0.125, -0.05, -0.11), bevel=0.005, name='rifle')
    r.rotation_euler = (0.55, 0, 0.22)


# ---------------------------------------------------------------------------
# Автоматоны
# ---------------------------------------------------------------------------

def _bot_head(eye='accent', z=0.02):
    """Голова-фонарь автоматона: короб с горящей щелью."""
    box(0.19, 0.15, 0.155, 'dark', (0, 0.01, z), taper=0.82, bevel=0.014, name='skull')
    box(0.13, 0.02, 0.028, eye, (0, 0.088, z + 0.02), bevel=0.005, name='eye')
    # вентиляционные рёбра
    for k in range(3):
        box(0.15, 0.016, 0.012, 'armorDark', (0, 0.05 - k * 0.03, z - 0.06), bevel=0.003,
            name=f'vent_{k}')


def vsa():
    """ВСА: базовый боевой автоматон — короб-череп, поршни, красная щель."""
    shoulders(0.32, 0.13, 'dark', -0.21)
    _bot_head()
    # поршни шеи
    for s in (-1, 1):
        cyl(0.020, 0.020, 0.09, 'armorDark', (s * 0.055, -0.02, -0.10), axis='Z', verts=10,
            name=f'piston_{s}')
    # рог-антенна
    cyl(0.008, 0.004, 0.13, 'armorDark', (-0.075, -0.02, 0.15), axis='Z', verts=8, name='ant')
    # клёпаный нагрудник
    box(0.17, 0.06, 0.09, 'armorDark', (0, 0.07, -0.20), bevel=0.008, name='chest')
    for k in range(3):
        cyl(0.008, 0.008, 0.012, 'accent', (-0.05 + k * 0.05, 0.103, -0.20), axis='Y',
            verts=8, name=f'rivet_{k}')


def incinerators():
    """Испепеляющий отряд: голова в жаровом кожухе, баки и сопло огнемёта."""
    shoulders(0.33, 0.14, 'dark', -0.21)
    _bot_head()
    # жаровой кожух поверх черепа
    box(0.21, 0.08, 0.06, 'armorDark', (0, 0.0, 0.10), bevel=0.01, name='hood')
    # баки за плечами
    for s in (-1, 1):
        cyl(0.045, 0.045, 0.20, 'armorDark', (s * 0.135, -0.06, -0.18), axis='Z', verts=14,
            name=f'tank_{s}')
        cyl(0.022, 0.022, 0.02, 'accent', (s * 0.135, -0.06, -0.07), axis='Z', verts=10,
            name=f'cap_{s}')
    # сопло с языком пламени
    n = cyl(0.026, 0.018, 0.14, 'armorDark', (0.13, 0.10, -0.13), axis='Y', verts=12,
            name='nozzle')
    n.rotation_euler.z = -0.3
    cone(0.030, 0.10, 'glow', (0.155, 0.20, -0.125), axis='Y', verts=10, name='flame')


def jets():
    """Реактивный отряд: аэродинамический шлем, ранец и факелы дюз."""
    shoulders(0.31, 0.13, 'dark', -0.21)
    _bot_head()
    # обтекатель
    cone(0.085, 0.13, 'dark', (0, 0.02, 0.14), axis='Z', verts=10, name='fairing')
    # ранец
    box(0.20, 0.07, 0.16, 'armorDark', (0, -0.10, -0.17), bevel=0.01, name='pack')
    for s in (-1, 1):
        cyl(0.032, 0.026, 0.10, 'armorDark', (s * 0.115, -0.11, -0.24), axis='Z', verts=12,
            name=f'jet_{s}')
        cone(0.026, 0.12, 'glow', (s * 0.115, -0.11, -0.36), axis='-Z', verts=10,
             name=f'flame_{s}')
    # крылья-стабилизаторы
    for s in (-1, 1):
        w = box(0.13, 0.05, 0.012, 'accent', (s * 0.16, -0.07, -0.11), taper=0.3, bevel=0.004,
                name=f'wing_{s}')
        w.rotation_euler.y = s * 0.45


def cyborgLegion():
    """Легион киборгов: полуживое лицо под стальной маской, единственный глаз."""
    shoulders(0.33, 0.16, 'dark', -0.25)
    # череп: живая половина слева, стальная маска справа — обе выходят вперёд
    hc, hr = (0, 0.0, 0.03), (0.105, 0.108, 0.115)
    sphere(1.0, 'flesh', hc, scale=hr, seg=26, rings=18, name='skull')
    m = box(0.115, 0.185, 0.215, 'dark', (0.058, 0.012, 0.03), taper=0.88, bevel=0.016,
            name='mask')
    void = m  # noqa: F841
    # единственный горящий окуляр на стальной половине
    cyl(0.032, 0.032, 0.035, 'armorDark', (0.058, 0.10, 0.048), axis='Y', verts=14,
        name='socket')
    cyl(0.021, 0.021, 0.02, 'glow', (0.058, 0.122, 0.048), axis='Y', verts=12, name='oculus')
    # живой глаз в тени
    sphere(0.014, 'armorDark', on_shell(hc, hr, (-0.45, 0.82, 0.24), 0.98), seg=10, rings=8,
           name='eye')
    # оскал протеза на живой половине
    box(0.05, 0.03, 0.03, 'armorDark', on_shell(hc, hr, (-0.35, 0.9, -0.45), 0.92),
        bevel=0.005, name='jaw')
    # кабели от затылка
    for s in (-1, 1):
        c = cyl(0.010, 0.010, 0.18, 'armorDark', (s * 0.065, -0.09, -0.09), axis='Z', verts=8,
                name=f'cable_{s}')
        c.rotation_euler.x = 0.35
    # реликтовый нагрудник легиона
    box(0.16, 0.06, 0.075, 'accent', (0, 0.075, -0.225), bevel=0.008, name='bust_sigil')


# ---------------------------------------------------------------------------
# Терминиды
# ---------------------------------------------------------------------------

def _bug_head(scale=1.0, eyes=4, m='organic'):
    """Хитиновая башка: приплюснутый череп, надбровный щиток и фасеточные глаза.

    Все накладки ставятся строго на поверхность (on_shell), иначе тонут внутри.
    """
    c = (0, 0.0, 0.0)
    r = (0.145 * scale, 0.125 * scale, 0.078 * scale)  # широкая приплюснутая морда
    h = sphere(1.0, m, c, scale=r, seg=30, rings=20, name='head')
    lumpy(h, 0.006, 0.05)
    # надбровный щиток — козырёк над глазами
    br = on_shell(c, r, (0, 0.5, 0.9), 0.95)
    p = box(0.21 * scale, 0.13 * scale, 0.045, 'organicDark', br, taper=0.75, bevel=0.012,
            name='brow')
    p.rotation_euler.x = -0.45
    # крупные фасеточные глаза — главный опознавательный знак на маленькой иконке
    for i in range(eyes):
        s = -1 if i % 2 == 0 else 1
        row = i // 2
        d = (s * (0.66 - row * 0.30), 0.80, 0.12 - row * 0.42)
        sphere(1.0, 'accent', on_shell(c, r, d, 0.94),
               scale=(0.034 * scale - row * 0.010, 0.028, 0.026 * scale - row * 0.008),
               seg=14, rings=10, name=f'eye_{i}')
    return h, c, r


def _mandibles(scale=1.0, spread=0.42, m='organicDark', length=0.21, out=0.085):
    """Жвалы: крупные серпы перед мордой — главный силуэтный признак роя.

    Основание прячется под черепом, остриё сходится к центру ниже глаз.
    """
    for s in (-1, 1):
        a = cone(0.028 * scale, length * scale, m, (s * out * scale, 0.105 * scale, -0.055),
                 axis='Y', verts=7, name=f'mand_{s}')
        a.rotation_euler.z = -s * spread
        a.rotation_euler.x = -0.42
        b = cone(0.017 * scale, length * 0.6 * scale, m,
                 (s * (out + 0.040) * scale, 0.085 * scale, -0.005), axis='Y', verts=6,
                 name=f'mand2_{s}')
        b.rotation_euler.z = -s * (spread + 0.45)
        b.rotation_euler.x = -0.15


def swarm():
    """Рой: рядовой жук — жвалы, фасеточные глаза, хитиновый воротник."""
    shoulders(0.28, 0.12, 'organic', -0.20, pads=False)
    _bug_head()
    _mandibles()
    # спинные шипы
    for k in range(3):
        cone(0.016, 0.06 - k * 0.008, 'organicDark', (0, -0.05 - k * 0.045, 0.09 - k * 0.03),
             axis='Z', verts=5, name=f'spine_{k}')
    # усики
    for s in (-1, 1):
        a = cone(0.008, 0.16, 'organicDark', (s * 0.06, 0.02, 0.13), axis='Z', verts=6,
                 name=f'ant_{s}')
        a.rotation_euler.y = s * 0.55


def breachStrain():
    """Прорывной штамм: лобовой таран и броневые пластины."""
    shoulders(0.32, 0.14, 'organic', -0.20, pads=False)
    _bug_head(1.05, eyes=2)
    _mandibles(1.15, 0.2)
    # таранный рог
    cone(0.045, 0.20, 'organicDark', (0, 0.16, 0.055), axis='Y', verts=8, name='ram')
    # броневые пластины на башке
    for k, (x, w) in enumerate(((0, 0.16), (-0.075, 0.07), (0.075, 0.07))):
        box(w, 0.10, 0.035, 'organicDark', (x, 0.0, 0.10 - k * 0.012), bevel=0.008,
            name=f'plate_{k}')
    # массивные наплечники-щиты
    for s in (-1, 1):
        p = sphere(0.085, 'organicDark', (s * 0.145, 0.0, -0.16), scale=(1, 0.9, 0.65),
                   seg=18, rings=12, name=f'shield_{s}')
        lumpy(p, 0.006, 0.05)


def predatorStrain():
    """Штамм-хищник: узкая вытянутая башка, длинные серпы, горящие глаза."""
    shoulders(0.27, 0.14, 'organic', -0.24, pads=False)
    hc, hr = (0, 0.02, 0.0), (0.088, 0.145, 0.082)
    h = sphere(1.0, 'organic', hc, scale=hr, seg=28, rings=18, name='head')
    lumpy(h, 0.006, 0.05)
    for s in (-1, 1):
        sphere(1.0, 'glow', on_shell(hc, hr, (s * 0.5, 0.72, 0.42), 0.97),
               scale=(0.024, 0.024, 0.017), seg=14, rings=10, name=f'eye_{s}')
    # серпы-жвалы — длинные, скрещиваются перед мордой
    for s in (-1, 1):
        a = cone(0.020, 0.26, 'organicDark', (s * 0.055, 0.18, -0.045), axis='Y', verts=7,
                 name=f'scythe_{s}')
        a.rotation_euler.z = -s * 0.40
        a.rotation_euler.x = -0.32
        b = cone(0.012, 0.14, 'organicDark', (s * 0.085, 0.13, 0.0), axis='Y', verts=6,
                 name=f'scythe2_{s}')
        b.rotation_euler.z = -s * 0.85
    # гребень охотника вдоль затылка (короткий — иначе кадр уезжает назад)
    for k in range(3):
        c = cone(0.013, 0.075 - k * 0.012, 'organicDark', (0, -0.06 - k * 0.042, 0.065),
                 axis='Z', verts=5, name=f'crest_{k}')
        c.rotation_euler.x = -0.5


def sporeStrain():
    """Споровый штамм: раздутые мешки Мрака и дыхательные трубки."""
    shoulders(0.30, 0.13, 'organic', -0.20, pads=False)
    _bug_head(0.9, eyes=2)
    _mandibles(0.8, 0.5)
    # споровые мешки
    for i, (x, z, r) in enumerate(((-0.13, -0.05, 0.075), (0.13, -0.05, 0.075),
                                   (0, -0.12, 0.065), (-0.08, -0.18, 0.05),
                                   (0.08, -0.18, 0.05))):
        s = sphere(r, 'glow', (x, -0.03, z), scale=(1, 0.85, 1), seg=16, rings=12,
                   name=f'sac_{i}')
        lumpy(s, 0.005, 0.04)
    # выпускные трубки
    for s in (-1, 1):
        cyl(0.014, 0.010, 0.11, 'organicDark', (s * 0.10, 0.02, 0.06), axis='Z', verts=8,
            name=f'tube_{s}')


# ---------------------------------------------------------------------------
# Иллюминаты
# ---------------------------------------------------------------------------

def greatFleet():
    """Великий флот: воин-пришелец в вытянутом шлеме с вертикальным оком."""
    shoulders(0.30, 0.15, 'armor', -0.25)
    # вытянутый шлем-капля: скруглённая коробка держит плоскую лицевую грань
    helm(0.155, 0.155, 0.26, (0, 0, 0.045), 'armor', 0.055, taper=0.8, name='skull')
    # маска-пластина выступает вперёд шлема
    box(0.125, 0.055, 0.215, 'armorDark', (0, 0.085, 0.035), taper=0.7, bevel=0.014,
        name='mask')
    sphere(1.0, 'glow', (0, 0.113, 0.055), scale=(0.021, 0.02, 0.062), seg=18, rings=14,
           name='eye')
    # рассечённые надбровные дуги
    for s in (-1, 1):
        b = box(0.02, 0.05, 0.11, 'accent', (s * 0.058, 0.088, 0.055), bevel=0.005,
                name=f'brow_{s}')
        b.rotation_euler.y = s * 0.22
    # три кольца-нимба над головой
    for k, r in enumerate((0.072, 0.052, 0.032)):
        torus(r, 0.006, 'accent', (0, 0.0, 0.195 + k * 0.032), name=f'halo_{k}')
    # плащевые пластины
    for s in (-1, 1):
        p = box(0.075, 0.06, 0.14, 'armorDark', (s * 0.125, 0.0, -0.20), bevel=0.008,
                name=f'bust_mantle_{s}')
        p.rotation_euler.y = s * 0.3


def voteless():
    """Безмозглые массы: обращённый горожанин, пустой светящийся взгляд."""
    shoulders(0.28, 0.14, 'armorDark', -0.24, pads=False)
    # исхудалая голова
    hc, hr = (0, 0.01, 0.02), (0.088, 0.10, 0.115)
    sphere(1.0, 'flesh', hc, scale=hr, seg=26, rings=18, name='head')
    # провалы глазниц со свечением — строго на поверхности
    for s in (-1, 1):
        d = (s * 0.42, 0.82, 0.30)
        sphere(1.0, 'armorDark', on_shell(hc, hr, d, 0.93),
               scale=(0.028, 0.028, 0.034), seg=14, rings=10, name=f'socket_{s}')
        sphere(0.014, 'glow', on_shell(hc, hr, d, 1.0), seg=10, rings=8, name=f'eye_{s}')
    # разинутый рот
    box(0.05, 0.035, 0.055, 'armorDark', on_shell(hc, hr, (0, 0.92, -0.42), 0.93),
        bevel=0.006, name='mouth')
    # имплант-обруч конверсии на лбу
    torus(0.094, 0.011, 'accent', (0, 0.01, 0.085), rot=(0.14, 0, 0), name='band')
    cyl(0.012, 0.008, 0.06, 'accent', (0, 0.055, 0.135), axis='Z', verts=10, name='spike')
    # обрывки одежды
    for s in (-1, 1):
        box(0.10, 0.05, 0.10, 'armorDark', (s * 0.10, 0.0, -0.22), bevel=0.006,
            name=f'bust_rag_{s}')


def confiscators():
    """Конфискаторы: парящий сборщик — капюшон, линза и захваты."""
    shoulders(0.26, 0.14, 'armorDark', -0.25, pads=False)
    # капюшон сзади, лицевая маска — вперёд
    sphere(1.0, 'armorDark', (0, -0.045, 0.03), scale=(0.125, 0.115, 0.125), seg=26,
           rings=18, name='hood')
    helm(0.145, 0.155, 0.145, (0, 0.045, 0.005), 'armor', 0.04, taper=0.85, name='face')
    # главная линза
    cyl(0.046, 0.046, 0.035, 'armorDark', (0, 0.108, 0.015), axis='Y', verts=18, name='rim')
    cyl(0.031, 0.031, 0.022, 'glow', (0, 0.128, 0.015), axis='Y', verts=16, name='lens')
    # малые окуляры по бокам
    for s in (-1, 1):
        cyl(0.013, 0.013, 0.018, 'glow', (s * 0.062, 0.098, -0.035), axis='Y', verts=10,
            name=f'lens2_{s}')
    # антигравитационное кольцо под капюшоном
    torus(0.155, 0.010, 'accent', (0, -0.01, -0.235), name='grav')
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        cyl(0.008, 0.008, 0.07, 'armorDark',
            (math.cos(a) * 0.108, math.sin(a) * 0.108 - 0.01, -0.205), axis='Z', verts=8,
            name=f'strut_{i}')
    # захваты для «урожая»
    for s in (-1, 1):
        c = box(0.028, 0.16, 0.028, 'armorDark', (s * 0.135, 0.07, -0.145), taper=0.5,
                bevel=0.006, name=f'claw_{s}')
        c.rotation_euler.z = -s * 0.22


# ---------------------------------------------------------------------------
# Супер-Федерация
# ---------------------------------------------------------------------------

def fedArmy():
    """Армия Федерации: ополченец в самодельной каске из приваренных пластин."""
    shoulders(0.29, 0.15, 'armor', -0.24, pads=False)
    fc, fr = (0, 0.035, -0.028), (0.080, 0.090, 0.098)
    sphere(1.0, 'flesh', fc, scale=fr, seg=24, rings=16, name='face')
    for s in (-1, 1):
        sphere(0.012, 'armorDark', on_shell(fc, fr, (s * 0.42, 0.85, 0.28), 0.97),
               seg=10, rings=8, name=f'eye_{s}')
    box(0.05, 0.03, 0.022, 'armorDark', on_shell(fc, fr, (0, 0.9, -0.45), 0.9), bevel=0.004,
        name='mouth')
    # каска-скорлупа поверх
    sphere(1.0, 'armor', (0, 0.005, 0.05), scale=(0.106, 0.108, 0.082), seg=26, rings=18,
           name='helm')
    # приваренные пластины на каске
    for k, (x, y, rz) in enumerate(((-0.05, 0.03, 0.35), (0.055, 0.0, -0.25), (0, 0.07, 0.0))):
        p = box(0.075, 0.065, 0.022, 'armorDark', (x, y, 0.105), bevel=0.005,
                name=f'patch_{k}')
        p.rotation_euler.z = rz
        p.rotation_euler.x = -0.2
    # шарф Конкорда
    torus(0.098, 0.020, 'accent', (0, 0.01, -0.125), rot=(0.18, 0, 0), name='scarf')


def fedGuard():
    """Гвардия Конкорда: бывшие хеллдайверы — трофейная броня СЗ в иных цветах."""
    shoulders(0.34, 0.16, 'armor', -0.25)
    # трофейный шлем СЗ — тот же силуэт, но перекрашен и посечён
    helm(0.20, 0.185, 0.20, (0, 0, 0.02), 'armor', 0.05, name='helm')
    box(0.165, 0.045, 0.085, 'armorDark', (0, 0.095, 0.035), bevel=0.01, name='mask')
    visor_slit(0.113, 0.038, 0.14, 0.030)
    # рассечённый визор — след старой войны
    b = box(0.014, 0.035, 0.085, 'armorDark', (0.038, 0.118, 0.042), bevel=0.003, name='crack')
    b.rotation_euler.y = 0.38
    # боковые гребни вместо центрального
    for s in (-1, 1):
        c = box(0.02, 0.16, 0.028, 'accent', (s * 0.058, -0.005, 0.122), taper=0.5,
                bevel=0.006, name=f'crest_{s}')
        c.rotation_euler.y = s * 0.18
    box(0.095, 0.075, 0.055, 'armorDark', (0, 0.085, -0.058), bevel=0.012, name='resp')


# ---------------------------------------------------------------------------
# Супероружие фракций
# ---------------------------------------------------------------------------

def dss():
    """ДКС: демократическая космическая станция — кольцо, ядро, орудийные шпили."""
    sphere(0.13, 'armor', (0, 0, 0), seg=30, rings=22, name='core')
    sphere(0.06, 'armorDark', (0, 0, 0.115), scale=(1, 1, 0.6), seg=20, rings=14, name='cap')
    torus(0.20, 0.016, 'armor', (0, 0, 0), name='ring')
    torus(0.20, 0.006, 'accent', (0, 0, 0.021), name='ring_lit')
    for i in range(4):
        a = i * math.pi / 2
        p = box(0.014, 0.085, 0.022, 'armorDark', (math.cos(a) * 0.165, math.sin(a) * 0.165, 0),
                bevel=0.004, name=f'pylon_{i}')
        p.rotation_euler.z = a + math.pi / 2
    # орудийные шпили (короткие — иначе станция теряется в кадре)
    for s in (-1, 1):
        cyl(0.014, 0.009, 0.13, 'armorDark', (0, 0, s * 0.155), axis='Z', verts=10,
            name=f'spire_{s}')
        sphere(0.018, 'glow', (0, 0, s * 0.225), seg=12, rings=8, name=f'muzzle_{s}')
    torus(0.131, 0.005, 'glow', (0, 0, -0.03), name='windows')
    # солнечные крылья
    for s in (-1, 1):
        box(0.10, 0.05, 0.006, 'glow', (s * 0.30, 0, 0), bevel=0.002, name=f'panel_{s}')
        cyl(0.005, 0.005, 0.06, 'armorDark', (s * 0.235, 0, 0), axis='X', verts=8,
            name=f'strut_{s}')


def starDestroyer():
    """АКС: станция-литейная автоматонов — клин, домны, багровые жерла."""
    box(0.30, 0.34, 0.10, 'dark', (0, 0, 0), taper=0.45, bevel=0.012, name='wedge')
    box(0.18, 0.14, 0.09, 'dark', (0, -0.09, 0.085), taper=0.8, bevel=0.01, name='citadel')
    box(0.11, 0.012, 0.02, 'accent', (0, -0.02, 0.10), bevel=0.004, name='eye')
    # домны
    for i, (x, y) in enumerate(((-0.06, -0.13), (0.06, -0.13), (0, -0.16))):
        cyl(0.024, 0.020, 0.11, 'armorDark', (x, y, 0.16), axis='Z', verts=12,
            name=f'stack_{i}')
        cyl(0.015, 0.015, 0.016, 'accent', (x, y, 0.222), axis='Z', verts=10, name=f'ember_{i}')
    # клешни-доки
    for s in (-1, 1):
        c = box(0.03, 0.22, 0.03, 'armorDark', (s * 0.115, 0.14, 0), taper=0.7, bevel=0.006,
                name=f'claw_{s}')
        c.rotation_euler.z = -s * 0.14
    # багровые жерла кормы
    for i, x in enumerate((-0.08, 0, 0.08)):
        box(0.045, 0.03, 0.045, 'armorDark', (x, -0.185, -0.005), bevel=0.006, name=f'vent_{i}')
        box(0.032, 0.012, 0.032, 'glow', (x, -0.203, -0.005), bevel=0.004, name=f'burn_{i}')


def monolith():
    """Монолит Великого Воинства: чёрная плита с оком и парящими кольцами."""
    box(0.17, 0.09, 0.44, 'armorDark', (0, 0, 0.02), bevel=0.012, name='slab')
    # грани-фаски с сиянием
    for s in (-1, 1):
        box(0.014, 0.07, 0.40, 'accent', (s * 0.086, 0, 0.02), bevel=0.004, name=f'edge_{s}')
    # вертикальное око
    e = sphere(0.048, 'glow', (0, 0.05, 0.09), scale=(0.5, 0.5, 1.25), seg=20, rings=16,
               name='eye')
    void = e  # noqa: F841
    torus(0.062, 0.008, 'accent', (0, 0.048, 0.09), rot=(math.pi / 2, 0, 0), name='eye_ring')
    # парящие кольца вокруг плиты
    for k, (r, z, tilt) in enumerate(((0.20, -0.13, 0.0), (0.16, 0.20, 0.22),
                                      (0.13, 0.28, -0.18))):
        torus(r, 0.007, 'accent', (0, 0, z), rot=(tilt, 0, 0), name=f'halo_{k}')
    # осколки-спутники
    for i in range(5):
        a = i * math.pi * 2 / 5
        c = cone(0.018, 0.05, 'glow', (math.cos(a) * 0.175, math.sin(a) * 0.175, -0.13),
                 axis='Z', verts=6, name=f'shard_{i}')
        c.rotation_euler.y = 0.5


def superColony():
    """Суперколония: живая гора-улей с выводковыми жерлами и гребнем шипов."""
    b = sphere(0.24, 'organic', (0, 0, -0.06), scale=(1, 1, 0.72), seg=32, rings=22,
               name='mound')
    lumpy(b, 0.022, 0.10)
    d = sphere(0.15, 'organic', (0, -0.02, 0.10), scale=(1, 1, 0.85), seg=26, rings=18,
               name='dome')
    lumpy(d, 0.016, 0.08)
    # центральное жерло
    cyl(0.055, 0.075, 0.10, 'organicDark', (0, -0.02, 0.20), axis='Z', verts=16, name='maw')
    cyl(0.042, 0.042, 0.03, 'glow', (0, -0.02, 0.235), axis='Z', verts=14, name='maw_glow')
    # боковые выводковые жерла
    for i in range(5):
        a = i * math.pi * 2 / 5 + 0.4
        x, y = math.cos(a) * 0.155, math.sin(a) * 0.155
        v = cyl(0.030, 0.040, 0.07, 'organicDark', (x, y, 0.09), axis='Z', verts=10,
                name=f'vent_{i}')
        v.rotation_euler = (y * 1.6, -x * 1.6, 0)
        sphere(0.022, 'glow', (x, y, 0.125), seg=12, rings=8, name=f'brood_{i}')
    # гребень шипов по кромке
    for i in range(9):
        a = i * math.pi * 2 / 9
        c = cone(0.020, 0.13, 'organicDark', (math.cos(a) * 0.215, math.sin(a) * 0.215, 0.0),
                 axis='Z', verts=6, name=f'spike_{i}')
        c.rotation_euler = (math.sin(a) * 0.7, -math.cos(a) * 0.7, 0)


# ---------------------------------------------------------------------------
# Реестр, сцена, рендер
# ---------------------------------------------------------------------------

UNITS = {
    # наземные подразделения
    'helldivers': ('superEarth', helldivers),
    'seaf': ('superEarth', seaf),
    'vsa': ('automatons', vsa),
    'incinerators': ('automatons', incinerators),
    'jets': ('automatons', jets),
    'cyborgLegion': ('automatons', cyborgLegion),
    'swarm': ('terminids', swarm),
    'breachStrain': ('terminids', breachStrain),
    'predatorStrain': ('terminids', predatorStrain),
    'sporeStrain': ('terminids', sporeStrain),
    'greatFleet': ('illuminate', greatFleet),
    'voteless': ('illuminate', voteless),
    'confiscators': ('illuminate', confiscators),
    'fedArmy': ('superFederation', fedArmy),
    'fedGuard': ('superFederation', fedGuard),
    # супероружие
    'dss': ('superEarth', dss),
    'starDestroyer': ('automatons', starDestroyer),
    'monolith': ('illuminate', monolith),
    'superColony': ('terminids', superColony),
}


def setup_scene(faction: str, size: int, samples: int) -> None:
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.device = 'CPU'
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.film_transparent = True          # альфа для карточек
    sc.view_settings.view_transform = 'Standard'
    acc = PALETTES[faction]['accent']

    # Слабый холодный мир — чтобы тени не проваливались в чистый чёрный.
    w = bpy.data.worlds.new('ambient')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.09, 0.11, 0.16, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.45
    sc.world = w

    # Подразделения смотрят в +Y — там же стоит камера, поэтому ключ спереди (+Y),
    # заливка сбоку, фракционный контровой из-за спины (−Y).
    # Модель ~0.3 ед., светильники близко — мощности маленькие, иначе всё выгорает.
    bpy.ops.object.light_add(type='AREA', location=(-0.55, 0.75, 0.62))
    k = bpy.context.object
    k.data.energy = 11
    k.data.size = 0.9
    k.rotation_euler = (Vector((0, 0, -0.03)) - Vector(k.location)).to_track_quat('-Z', 'Y').to_euler()

    bpy.ops.object.light_add(type='AREA', location=(0.85, 0.45, -0.15))
    f = bpy.context.object
    f.data.energy = 3.5
    f.data.size = 1.1
    f.data.color = (0.55, 0.68, 1)
    f.rotation_euler = (Vector((0, 0, -0.05)) - Vector(f.location)).to_track_quat('-Z', 'Y').to_euler()

    bpy.ops.object.light_add(type='AREA', location=(0.25, -0.95, 0.45))
    r = bpy.context.object
    r.data.energy = 16
    r.data.size = 0.8
    r.data.color = acc[:3]
    r.rotation_euler = (Vector((0, 0, 0.02)) - Vector(r.location)).to_track_quat('-Z', 'Y').to_euler()


def frame_camera(margin: float = 1.24) -> None:
    """Ортокамера почти анфас: кадр строится по «голове», плечи срезаются краем.

    В расчёт габаритов не идут детали bust_* — так у всех подразделений
    получается единая портретная композиция, как в паспорте соединения.
    """
    sc = bpy.context.scene
    bpy.ops.object.camera_add()
    cam = bpy.context.object
    cam.data.type = 'ORTHO'
    sc.camera = cam
    # Камера стоит со стороны +Y — туда «смотрят» все подразделения.
    direction = Vector((0.30, 1.0, 0.20)).normalized()
    cam.location = direction * 3.0
    cam.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()

    # Габариты в системе координат камеры (без плечевого пояса).
    inv = cam.matrix_world.inverted()
    xs, ys = [], []
    for o in sc.objects:
        if o.type != 'MESH' or o.name.startswith('bust_'):
            continue
        for corner in o.bound_box:
            v = inv @ (o.matrix_world @ Vector(corner))
            xs.append(v.x)
            ys.append(v.y)
    if not xs:
        cam.data.ortho_scale = 1.0
        return
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    cam.data.ortho_scale = span * margin
    # Сдвинуть камеру так, чтобы «голова» встала по центру кадра.
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    cam.location += cam.matrix_world.to_3x3() @ Vector((cx, cy, 0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='src/assets/units')
    ap.add_argument('--only', default='')
    ap.add_argument('--size', type=int, default=256)
    ap.add_argument('--samples', type=int, default=64)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    wanted = [u for u in args.only.split(',') if u] or list(UNITS)

    for name in wanted:
        faction, build = UNITS[name]
        bpy.ops.wm.read_factory_settings(use_empty=True)
        palette(faction)
        build()
        setup_scene(faction, args.size, args.samples)
        frame_camera()
        sc = bpy.context.scene
        sc.render.image_settings.file_format = 'WEBP'
        sc.render.image_settings.color_mode = 'RGBA'
        sc.render.image_settings.quality = 92
        path = os.path.abspath(os.path.join(args.out, f'{name}.webp'))
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print(f'[unitforge] {name} ({faction}): {os.path.getsize(path) / 1024:.0f} KB -> {path}')




# ---------------------------------------------------------------------------
# Политика и спецоперации: предметные иконки вместо глифов.
# Кадрируются тем же портретным способом, палитра — Супер-Земли (в интерфейсе
# перекрашиваются фильтром под цвет фракции не нужно: значки нейтральные).
# ---------------------------------------------------------------------------

def pol_propaganda():
    """Пропаганда: трибуна с рупором и вымпелом."""
    box(0.26, 0.16, 0.10, 'armor', (0, 0, -0.16), taper=0.85, bevel=0.014, name='podium')
    box(0.20, 0.03, 0.09, 'accent', (0, 0.085, -0.15), bevel=0.006, name='crest')
    cyl(0.014, 0.014, 0.26, 'armorDark', (-0.02, 0.0, 0.02), axis='Z', verts=10, name='mast')
    h = cone(0.085, 0.17, 'armor', (0.055, 0.05, 0.10), axis='Y', verts=16, name='horn')
    h.rotation_euler = (0, 0.35, -0.5)
    cyl(0.022, 0.022, 0.06, 'armorDark', (-0.005, -0.03, 0.10), axis='Y', verts=10, name='grip')
    sphere(0.018, 'glow', (0.115, 0.13, 0.135), seg=12, rings=10, name='beam')


def pol_recruitment():
    """Призыв: шеренга шлемов на стойке."""
    for i, x in enumerate((-0.11, 0.0, 0.11)):
        z = 0.02 - abs(i - 1) * 0.02
        helm(0.105, 0.10, 0.10, (x, 0, z), 'armor', 0.03, name=f'helm_{i}')
        box(0.085, 0.025, 0.025, 'glow', (x, 0.055, z + 0.012), bevel=0.003, name=f'visor_{i}')
    box(0.34, 0.12, 0.04, 'armorDark', (0, 0, -0.10), bevel=0.008, name='rack')
    box(0.30, 0.03, 0.05, 'accent', (0, 0.06, -0.155), bevel=0.005, name='plate')


def pol_industry():
    """Промышленность: шестерня и наковальня."""
    torus(0.115, 0.030, 'armor', (0, 0, 0.03), rot=(math.pi / 2, 0, 0), seg=10, name='gear')
    for i in range(9):
        a = i * 2 * math.pi / 9
        box(0.035, 0.030, 0.045, 'armor', (math.cos(a) * 0.135, 0, 0.03 + math.sin(a) * 0.135),
            rot=(0, -a, 0), bevel=0.004, name=f'tooth_{i}')
    cyl(0.042, 0.042, 0.05, 'armorDark', (0, 0, 0.03), axis='Y', verts=14, name='hub')
    box(0.24, 0.10, 0.05, 'armorDark', (0, 0, -0.14), taper=0.7, bevel=0.008, name='anvil')
    box(0.10, 0.06, 0.03, 'accent', (0, 0.03, -0.185), bevel=0.005, name='base')


def pol_shipcap():
    """Верфи: стапель с корпусом на нём."""
    for s in (-1, 1):
        box(0.035, 0.10, 0.30, 'armorDark', (s * 0.135, 0, 0.0), bevel=0.006, name=f'gantry_{s}')
        for k in range(3):
            box(0.24, 0.03, 0.02, 'armorDark', (0, 0, 0.10 - k * 0.10), bevel=0.003,
                name=f'beam_{s}_{k}')
    box(0.13, 0.24, 0.10, 'armor', (0, 0.02, 0.02), taper=0.55, bevel=0.012, name='hull')
    box(0.075, 0.05, 0.045, 'accent', (0, 0.055, 0.055), bevel=0.005, name='stripe')
    for i, x in enumerate((-0.03, 0.03)):
        cyl(0.017, 0.017, 0.03, 'glow', (x, -0.115, 0.02), axis='Y', verts=10, name=f'jet_{i}')


def pol_emergency():
    """Чрезвычайные меры: сирена под колпаком."""
    cyl(0.10, 0.115, 0.09, 'armorDark', (0, 0, -0.14), axis='Z', verts=18, name='base')
    cyl(0.085, 0.085, 0.14, 'glow', (0, 0, -0.02), axis='Z', verts=18, name='lamp')
    for i in range(6):
        a = i * math.pi / 3
        box(0.016, 0.016, 0.15, 'armorDark', (math.cos(a) * 0.086, math.sin(a) * 0.086, -0.02),
            bevel=0.003, name=f'cage_{i}')
    cyl(0.10, 0.075, 0.06, 'armor', (0, 0, 0.08), axis='Z', verts=18, name='cap')
    torus(0.095, 0.012, 'accent', (0, 0, 0.055), name='ring')


def pol_fortify():
    """Укрепления: бастион с зубцами и щитом."""
    box(0.30, 0.14, 0.16, 'armorDark', (0, 0, -0.10), taper=0.9, bevel=0.012, name='wall')
    for i, x in enumerate((-0.115, -0.038, 0.038, 0.115)):
        box(0.055, 0.14, 0.06, 'armorDark', (x, 0, 0.0), bevel=0.006, name=f'merlon_{i}')
    b = box(0.15, 0.05, 0.19, 'armor', (0, 0.085, -0.05), taper=0.55, bevel=0.012, name='shield')
    void = b  # noqa: F841
    box(0.10, 0.03, 0.035, 'accent', (0, 0.115, -0.02), bevel=0.005, name='band')


def op_sabotage():
    """Диверсия: заряд с таймером."""
    cyl(0.10, 0.10, 0.20, 'armorDark', (0, 0, -0.02), axis='Z', verts=16, name='charge')
    torus(0.102, 0.012, 'accent', (0, 0, 0.04), name='band1')
    torus(0.102, 0.012, 'accent', (0, 0, -0.06), name='band2')
    box(0.11, 0.045, 0.06, 'armor', (0, 0.075, 0.08), bevel=0.006, name='timer')
    box(0.075, 0.02, 0.03, 'glow', (0, 0.10, 0.085), bevel=0.003, name='display')
    for s in (-1, 1):
        c = cyl(0.008, 0.008, 0.13, 'armorDark', (s * 0.06, 0.03, 0.14), axis='Z', verts=8,
                name=f'wire_{s}')
        c.rotation_euler.y = s * 0.5


def op_recon():
    """Разведка: зонд с тарелкой и линзой."""
    sphere(0.095, 'armor', (0, 0, 0), scale=(1, 1, 0.9), seg=22, rings=16, name='body')
    c = cone(0.10, 0.07, 'armorDark', (0, 0.10, 0.02), axis='Y', verts=20, name='dish')
    void = c  # noqa: F841
    cyl(0.020, 0.020, 0.03, 'glow', (0, 0.135, 0.02), axis='Y', verts=12, name='lens')
    for s in (-1, 1):
        box(0.075, 0.045, 0.006, 'glow', (s * 0.155, -0.02, 0), bevel=0.002, name=f'panel_{s}')
        cyl(0.007, 0.007, 0.06, 'armorDark', (s * 0.11, -0.02, 0), axis='X', verts=8,
            name=f'arm_{s}')
    cyl(0.005, 0.004, 0.14, 'armorDark', (0, -0.05, 0.11), axis='Z', verts=8, name='ant')


def op_uprising():
    """Восстание: поднятый кулак со сломанной цепью."""
    box(0.10, 0.085, 0.115, 'flesh', (0, 0, 0.06), taper=0.9, bevel=0.022, name='fist')
    for i, x in enumerate((-0.028, 0.0, 0.028)):
        box(0.024, 0.075, 0.028, 'flesh', (x, 0.015, 0.125), bevel=0.008, name=f'knuckle_{i}')
    box(0.055, 0.075, 0.03, 'flesh', (0.052, 0.01, 0.075), rot=(0, 0, -0.4), bevel=0.01,
        name='thumb')
    cyl(0.048, 0.055, 0.13, 'armorDark', (0, 0, -0.07), axis='Z', verts=14, name='wrist')
    # обрывок цепи
    for i, (x, z) in enumerate(((-0.075, -0.10), (-0.11, -0.16), (0.075, -0.11))):
        t = torus(0.028, 0.010, 'armor', (x, 0, z), rot=(math.pi / 2 * (i % 2), 0, 0),
                  seg=14, name=f'link_{i}')
        void = t  # noqa: F841
    box(0.085, 0.04, 0.03, 'accent', (0, 0.05, -0.15), bevel=0.005, name='band')


UNITS.update({
    'pol_propaganda': ('superEarth', pol_propaganda),
    'pol_recruitment': ('superEarth', pol_recruitment),
    'pol_industry': ('superEarth', pol_industry),
    'pol_shipCap': ('superEarth', pol_shipcap),
    'pol_emergency': ('superEarth', pol_emergency),
    'pol_fortify': ('superEarth', pol_fortify),
    'op_sabotage': ('superEarth', op_sabotage),
    'op_recon': ('superEarth', op_recon),
    'op_uprising': ('superEarth', op_uprising),
})


if __name__ == '__main__':
    main()
