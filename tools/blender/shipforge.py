# -*- coding: utf-8 -*-
"""Кузница кораблей: процедурная генерация 3D-моделей флота в Blender (bpy).

Запуск:  python3 tools/blender/shipforge.py --out src/assets/ships [--previews DIR] [--only se_destroyer]

Каждая модель собирается в чистой сцене из примитивов с фасками, гриблами и
эмиссивными материалами, затем экспортируется в GLB (three.js читает его
напрямую). Оси: в Blender нос корабля смотрит в +Y, верх — +Z; перед экспортом
сцена разворачивается на 180° вокруг Z, чтобы в glTF нос оказался в +Z
(соглашение игры), а верх — в +Y.

Имена материалов — контракт с src/render/shipAssets.ts:
  hull / dark / accent / glow / organic / organicDark
Игра подменяет их своими материалами (accent и glow красятся в цвет фракции),
поэтому цвета ниже важны только для превью-рендеров.
"""
import argparse
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix

# ---------------------------------------------------------------------------
# Материалы
# ---------------------------------------------------------------------------

MAT_SPECS = {
    'hull':        dict(color=(0.55, 0.60, 0.66, 1), metallic=0.75, rough=0.42),
    'dark':        dict(color=(0.13, 0.15, 0.18, 1), metallic=0.80, rough=0.55),
    'accent':      dict(color=(1.00, 0.72, 0.04, 1), metallic=0.30, rough=0.45, emit=1.2, emitc=(1, 0.72, 0.05, 1)),
    'glow':        dict(color=(0.55, 0.80, 1.00, 1), metallic=0.00, rough=0.30, emit=9.0, emitc=(0.55, 0.8, 1, 1)),
    'organic':     dict(color=(0.48, 0.38, 0.16, 1), metallic=0.05, rough=0.80),
    'organicDark': dict(color=(0.22, 0.16, 0.07, 1), metallic=0.05, rough=0.70),
}
# Для превью каждой фракции подсвечиваем accent её цветом (в игре красится кодом).
ACCENTS = {
    'se':  (1.00, 0.82, 0.08, 1),
    'aut': (1.00, 0.22, 0.10, 1),
    'ill': (0.65, 0.45, 1.00, 1),
    'trm': (1.00, 0.55, 0.12, 1),
}


def mat(name: str):
    m = bpy.data.materials.get(name)
    if m:
        return m
    spec = MAT_SPECS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = spec['color']
    b.inputs['Metallic'].default_value = spec.get('metallic', 0.0)
    b.inputs['Roughness'].default_value = spec.get('rough', 0.5)
    if spec.get('emit'):
        b.inputs['Emission Color'].default_value = spec['emitc']
        b.inputs['Emission Strength'].default_value = spec['emit']
    return m


# ---------------------------------------------------------------------------
# Примитивы. Оси: X — ширина, Y — длина (нос +Y), Z — высота.
# ---------------------------------------------------------------------------

def _finish(o, m: str, bevel: float, name: str):
    o.name = name
    o.data.materials.append(mat(m))
    if bevel > 0:
        md = o.modifiers.new('bev', 'BEVEL')
        md.width = bevel
        md.segments = 2
        md.limit_method = 'ANGLE'
        md.angle_limit = math.radians(40)
    return o


def box(w, l, h, m='hull', at=(0, 0, 0), rot=(0, 0, 0), bevel=0.004, name='part',
        taper=None, taper_z=None):
    """Параллелепипед; taper — сужение носовой половины (по X и Z)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=at, rotation=rot)
    o = bpy.context.active_object
    o.scale = (w, l, h)  # куб size=1 имеет габарит 1 — масштаб равен размеру
    bpy.ops.object.transform_apply(scale=True)
    if taper is not None:
        # Локальные координаты меша центрированы в нуле — сужаем переднюю
        # половину (+Y) вокруг локальной оси.
        tz = taper if taper_z is None else taper_z
        bm = bmesh.new()
        bm.from_mesh(o.data)
        for v in bm.verts:
            if v.co.y > 1e-6:
                v.co.x *= taper
                v.co.z *= tz
        bm.to_mesh(o.data)
        bm.free()
    return _finish(o, m, bevel, name)


def cyl(r1, r2, l, m='hull', at=(0, 0, 0), axis='Y', verts=12, bevel=0.0, name='part'):
    rot = {'Y': (-math.pi / 2, 0, 0), 'Z': (0, 0, 0), 'X': (0, math.pi / 2, 0)}[axis]
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=l,
                                    location=at, rotation=rot)
    return _finish(bpy.context.active_object, m, bevel, name)


def cone(r, l, m='hull', at=(0, 0, 0), axis='Y', verts=8, back=False, name='part', bevel=0.0):
    a = {'Y': (-math.pi / 2, 0, 0), 'Z': (0, 0, 0), 'X': (0, math.pi / 2, 0),
         '-Z': (math.pi, 0, 0)}[axis]
    if back and axis == 'Y':
        a = (math.pi / 2, 0, 0)
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=0, depth=l,
                                    location=at, rotation=a)
    return _finish(bpy.context.active_object, m, bevel, name)


def sphere(r, m='hull', at=(0, 0, 0), scale=(1, 1, 1), seg=24, rings=16, smooth=True, name='part'):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=at)
    o = bpy.context.active_object
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    if smooth:
        bpy.ops.object.shade_smooth()
    return _finish(o, m, 0, name)


def torus(R, r, m='accent', at=(0, 0, 0), rot=(0, 0, 0), seg=36, name='ring'):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg,
                                     minor_segments=10, location=at, rotation=rot)
    o = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    return _finish(o, m, 0, name)


def lumpy(o, strength=0.012, size=0.09, seed_ofs=0.0):
    """Хитиновая бугристость: displace шумом (для терминидов)."""
    tex = bpy.data.textures.get('lump')
    if tex is None:
        tex = bpy.data.textures.new('lump', 'CLOUDS')
        tex.noise_scale = size
        tex.noise_depth = 2
    md = o.modifiers.new('disp', 'DISPLACE')
    md.texture = tex
    md.strength = strength
    md.texture_coords = 'GLOBAL'
    return o


def greebles(area_w, area_l, at, rows=2, cols=5, m='dark', h=0.006, seed=1):
    """Ряды мелких блоков-надстроек на корпусе (техно-фактура)."""
    import random
    rnd = random.Random(seed)
    for i in range(rows):
        for j in range(cols):
            if rnd.random() < 0.25:
                continue
            w = rnd.uniform(0.35, 0.9) * area_w / cols
            l = rnd.uniform(0.35, 0.9) * area_l / rows
            x = at[0] - area_w / 2 + (j + 0.5) * area_w / cols
            y = at[1] - area_l / 2 + (i + 0.5) * area_l / rows
            box(w, l, h * rnd.uniform(0.6, 1.6), m, (x, y, at[2]), bevel=0.001,
                name=f'grb_{i}_{j}')


# ---------------------------------------------------------------------------
# Супер-Земля: канонический силуэт супер-эсминца — вытянутый корпус, широкая
# средняя часть, мостик, тройной нос-трезубец, скобы кормы с блоком двигателей.
# ---------------------------------------------------------------------------

def se_destroyer():
    # основной корпус со скошенным носом
    box(0.075, 0.30, 0.048, 'hull', (0, 0.01, 0), taper=0.55, name='hull_main')
    # широкая средняя часть — грузовые отсеки со скосом бортов
    box(0.118, 0.14, 0.030, 'dark', (0, -0.015, -0.006), taper=0.85, name='cargo')
    box(0.128, 0.075, 0.020, 'hull', (0, -0.02, -0.002), name='cargo_wide')
    # килевая балка
    box(0.03, 0.24, 0.016, 'dark', (0, 0, -0.03), name='keel')
    # мостик: два яруса со скосом, тёмная полоса иллюминаторов
    box(0.052, 0.055, 0.026, 'hull', (0, 0.075, 0.032), taper=0.7, name='bridge')
    box(0.036, 0.03, 0.016, 'hull', (0, 0.07, 0.052), taper=0.7, name='bridge2')
    box(0.0375, 0.026, 0.007, 'glow', (0, 0.0865, 0.036), bevel=0.001, name='bridge_win')
    # нос-трезубец: центральный пилон длиннее и выше
    box(0.017, 0.19, 0.017, 'hull', (0, 0.20, 0.011), taper=0.6, name='prong_c')
    box(0.013, 0.135, 0.013, 'dark', (0.034, 0.1825, 0), taper=0.6, name='prong_r')
    box(0.013, 0.135, 0.013, 'dark', (-0.034, 0.1825, 0), taper=0.6, name='prong_l')
    cyl(0.0018, 0.0018, 0.05, 'dark', (0, 0.285, 0.028), axis='Y', verts=6, name='antenna')
    cyl(0.004, 0.004, 0.008, 'glow', (0, 0.285, 0.052), axis='Z', verts=8, name='beacon')
    # корма: две скобообразные панели
    for s in (-1, 1):
        box(0.02, 0.085, 0.064, 'dark', (s * 0.056, -0.135, 0), name=f'brace_{s}')
        box(0.026, 0.05, 0.012, 'hull', (s * 0.056, -0.12, 0.036), name=f'brace_top_{s}')
    # блок двигателей: три сопла с юбками и светящимися жерлами
    for i, x in enumerate((-0.028, 0, 0.028)):
        cyl(0.014, 0.011, 0.03, 'dark', (x, -0.155, 0), axis='Y', name=f'noz_{i}')
        cyl(0.0095, 0.0095, 0.012, 'glow', (x, -0.168, 0), axis='Y', name=f'jet_{i}')
    # фракционная полоса поперёк корпуса + бортовые ходовые огни
    box(0.077, 0.03, 0.05, 'accent', (0, 0.028, 0), bevel=0.002, name='stripe')
    # верхняя палуба: гриблы-надстройки
    greebles(0.06, 0.16, (0, -0.03, 0.027), rows=4, cols=3, seed=7)
    # нижние стабилизаторы
    for s in (-1, 1):
        b = box(0.05, 0.09, 0.008, 'dark', (s * 0.05, -0.07, -0.024), name=f'fin_{s}')
        b.rotation_euler.y = s * 0.5


def se_dreadnought():
    se_destroyer()
    # бортовые спонсоны с батареями
    for s in (-1, 1):
        box(0.032, 0.17, 0.032, 'hull', (s * 0.078, -0.01, 0.006), taper=0.7, name=f'spons_{s}')
        for k, y in enumerate((0.05, 0.0)):
            cyl(0.009, 0.009, 0.012, 'dark', (s * 0.078, y, 0.028), axis='Z', name=f'tur_{s}_{k}')
            cyl(0.0035, 0.003, 0.05, 'dark', (s * 0.078, y + 0.03, 0.033), axis='Y', verts=8,
                name=f'gun_{s}_{k}')
    # третий ярус мостика и антенная мачта
    box(0.024, 0.02, 0.014, 'hull', (0, 0.065, 0.066), name='bridge3')
    cyl(0.0016, 0.0016, 0.03, 'dark', (0, 0.06, 0.085), axis='Z', verts=6, name='mast')
    # усиленный киль с накладкой
    box(0.05, 0.1, 0.014, 'accent', (0, -0.05, -0.036), bevel=0.002, name='keel_acc')
    _scale_all(1.30)


def se_battleship():
    se_destroyer()
    # таранный клюв под трезубцем
    cone(0.02, 0.15, 'hull', (0, 0.30, -0.014), axis='Y', verts=4, name='ram')
    # крылья-панели с орудийными гондолами
    for s in (-1, 1):
        w = box(0.115, 0.15, 0.009, 'dark', (s * 0.1, -0.045, -0.008), name=f'wing_{s}')
        w.rotation_euler.y = s * 0.16
        box(0.022, 0.105, 0.022, 'hull', (s * 0.148, -0.045, 0.008), taper=0.65,
            name=f'pod_{s}')
        cyl(0.0032, 0.0028, 0.06, 'dark', (s * 0.148, 0.02, 0.012), axis='Y', verts=8,
            name=f'pgun_{s}')
        box(0.02, 0.04, 0.012, 'accent', (s * 0.148, -0.09, 0.006), bevel=0.002,
            name=f'ptail_{s}')
    # усиленная корма: пять сопел в нижнем ряду
    for i, x in enumerate((-0.05, -0.025, 0, 0.025, 0.05)):
        cyl(0.011, 0.009, 0.026, 'dark', (x, -0.152, -0.02), axis='Y', name=f'noz2_{i}')
        cyl(0.0075, 0.0075, 0.012, 'glow', (x, -0.164, -0.02), axis='Y', name=f'jet2_{i}')
    _scale_all(1.60)


# ---------------------------------------------------------------------------
# Автоматоны: фабрика-броненосец — слэб с клиновидным носом, дымовые трубы,
# щель-глаз, клешни, клёпаные плиты.
# ---------------------------------------------------------------------------

def aut_destroyer():
    box(0.092, 0.25, 0.055, 'dark', (0, -0.01, 0), taper=0.62, name='slab')
    # клин носовой брони
    box(0.07, 0.09, 0.04, 'dark', (0, 0.135, -0.004), taper=0.35, taper_z=0.5, name='prow')
    # башня с щелью-глазом
    box(0.052, 0.055, 0.05, 'dark', (0, -0.045, 0.05), taper=0.85, name='turret')
    box(0.038, 0.006, 0.009, 'accent', (0, -0.017, 0.056), bevel=0.001, name='eye')
    # дымовые трубы литейной с раскалёнными жерлами
    for i, (x, y) in enumerate(((-0.026, -0.095), (0.026, -0.095))):
        cyl(0.011, 0.009, 0.05, 'dark', (x, y, 0.05), axis='Z', name=f'stack_{i}')
        cyl(0.0065, 0.0065, 0.008, 'accent', (x, y, 0.077), axis='Z', name=f'ember_{i}')
    # клешни-манипуляторы
    for s in (-1, 1):
        c = box(0.02, 0.15, 0.024, 'dark', (s * 0.064, 0.09, 0), taper=0.7, name=f'claw_{s}')
        c.rotation_euler.z = -s * 0.08
        box(0.028, 0.035, 0.014, 'dark', (s * 0.072, 0.165, 0), name=f'claw_tip_{s}')
    # клёпаные бортовые плиты (заклёпки — мелкие цилиндры)
    for s in (-1, 1):
        p = box(0.012, 0.16, 0.05, 'hull', (s * 0.052, -0.02, 0.004), name=f'plate_{s}')
        p.rotation_euler.y = -s * 0.12
        for k in range(4):
            cyl(0.003, 0.003, 0.006, 'dark', (s * 0.059, 0.045 - k * 0.042, 0.02), axis='X',
                verts=6, name=f'rivet_{s}_{k}')
    # решётка радиатора сверху
    greebles(0.05, 0.09, (0, 0.03, 0.03), rows=3, cols=2, m='dark', seed=13)
    # квадратные сопла
    for i, x in enumerate((-0.03, 0.03)):
        box(0.026, 0.02, 0.026, 'dark', (x, -0.14, 0), name=f'vent_{i}')
        box(0.018, 0.008, 0.018, 'accent', (x, -0.152, 0), bevel=0.001, name=f'vglow_{i}')


def aut_dreadnought():
    aut_destroyer()
    # наплечные плиты
    for s in (-1, 1):
        p = box(0.034, 0.13, 0.075, 'dark', (s * 0.072, -0.035, 0.024), name=f'pauldron_{s}')
        p.rotation_euler.z = -s * 0.2
    # вторая башня и передний глаз
    box(0.042, 0.045, 0.04, 'dark', (0, 0.045, 0.048), taper=0.8, name='turret2')
    box(0.028, 0.005, 0.008, 'accent', (0, 0.068, 0.052), bevel=0.001, name='eye2')
    # третья труба по центру
    cyl(0.013, 0.011, 0.06, 'dark', (0, -0.13, 0.05), axis='Z', name='stack_c')
    cyl(0.008, 0.008, 0.008, 'accent', (0, -0.13, 0.082), axis='Z', name='ember_c')
    _scale_all(1.30)


def aut_battleship():
    # крепость: массивный корпус-башня и четыре клешни
    box(0.13, 0.29, 0.075, 'dark', (0, -0.01, 0), taper=0.7, name='slab')
    box(0.085, 0.1, 0.075, 'dark', (0, -0.055, 0.065), taper=0.8, name='citadel')
    box(0.052, 0.007, 0.012, 'accent', (0, -0.003, 0.075), bevel=0.001, name='eye_main')
    # четыре дымовые трубы по углам цитадели
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (-1, 1), (1, 1))):
        cyl(0.012, 0.010, 0.055, 'dark', (sx * 0.03, -0.055 + sy * 0.032, 0.11), axis='Z',
            name=f'stack_{i}')
        cyl(0.007, 0.007, 0.008, 'accent', (sx * 0.03, -0.055 + sy * 0.032, 0.14), axis='Z',
            name=f'ember_{i}')
    # четыре клешни-манипулятора (верхняя и нижняя пары)
    for i, (sx, sz) in enumerate(((-1, 1), (1, 1), (-1, -1), (1, -1))):
        c = box(0.024, 0.19, 0.024, 'dark', (sx * 0.088, 0.095, sz * 0.03), taper=0.75,
                name=f'claw_{i}')
        c.rotation_euler.z = -sx * 0.12
        box(0.032, 0.04, 0.015, 'dark', (sx * 0.10, 0.19, sz * 0.03), name=f'ctip_{i}')
    # броневые юбки бортов
    for s in (-1, 1):
        p = box(0.014, 0.24, 0.07, 'hull', (s * 0.068, -0.02, -0.01), name=f'skirt_{s}')
        p.rotation_euler.y = -s * 0.14
    greebles(0.08, 0.12, (0, 0.06, 0.04), rows=3, cols=3, m='dark', seed=29)
    for i, x in enumerate((-0.045, 0, 0.045)):
        box(0.03, 0.022, 0.03, 'dark', (x, -0.165, -0.01), name=f'vent_{i}')
        box(0.021, 0.008, 0.021, 'accent', (x, -0.178, -0.01), bevel=0.001, name=f'vg_{i}')
    _scale_all(1.60)


# ---------------------------------------------------------------------------
# Иллюминаты: блюдца-соборы — гладкие купола, кольца, шпили, кристаллы.
# ---------------------------------------------------------------------------

def ill_destroyer():
    # двухцветное блюдце: светлый верх, тёмное днище
    sphere(0.09, 'hull', (0, 0, 0.004), scale=(1, 1.2, 0.24), name='saucer')
    sphere(0.086, 'dark', (0, 0, -0.008), scale=(0.96, 1.14, 0.16), name='saucer_bottom')
    sphere(0.048, 'hull', (0, 0, 0.018), scale=(1, 1.08, 0.5), name='dome')
    # светящиеся кольца: экватор и основание купола
    torus(0.106, 0.005, 'accent', (0, 0, 0.002), name='ring')
    torus(0.05, 0.0035, 'accent', (0, 0, 0.028), name='dome_ring')
    # тонкий шпиль с сигнальным огнём
    cone(0.010, 0.10, 'hull', (0, -0.008, 0.075), axis='Z', verts=8, name='spire')
    sphere(0.0065, 'glow', (0, -0.008, 0.128), seg=12, rings=8, name='spire_tip')
    # три лезвия-плавника по корме — тонкие скошенные клинки
    for i, a in enumerate((-0.55, 0, 0.55)):
        f = box(0.0035, 0.085, 0.024, 'dark', (math.sin(a) * -0.088, math.cos(a) * -0.098, 0.002),
                bevel=0.001, taper=0.25, name=f'fin_{i}')
        f.rotation_euler.z = math.pi - a
        f.rotation_euler.x = 0.12
    # подвесной киль-кристалл
    c1 = cone(0.012, 0.045, 'glow', (0, 0.01, -0.042), axis='-Z', verts=6, name='keel')
    c1.rotation_euler.x = math.pi


def ill_dreadnought():
    ill_destroyer()
    # нижний ярус блюдца и подвесной кристалл
    sphere(0.065, 'hull', (0, 0, -0.033), scale=(1, 1.15, 0.28), name='saucer2')
    torus(0.072, 0.004, 'accent', (0, 0, -0.033), name='ring2')
    for i in range(6):
        a = i * math.pi / 3
        sphere(0.006, 'glow', (math.cos(a) * 0.05, math.sin(a) * 0.055, -0.05), seg=10,
               rings=8, name=f'lamp_{i}')
    cone(0.018, 0.06, 'glow', (0, 0.01, -0.085), axis='-Z', verts=6, name='crystal')
    _scale_all(1.30)


def ill_battleship():
    # ковчег-собор: вытянутый купол, двойное кольцо, тройка шпилей
    sphere(0.11, 'hull', (0, 0, 0.004), scale=(1, 1.35, 0.30), name='nave')
    sphere(0.105, 'dark', (0, 0, -0.01), scale=(0.95, 1.28, 0.18), name='nave_bottom')
    sphere(0.065, 'hull', (0, 0.02, 0.022), scale=(1, 1.28, 0.46), name='dome')
    torus(0.128, 0.0055, 'accent', (0, 0, 0.002), name='ring_in')
    torus(0.163, 0.004, 'accent', (0, 0, -0.006), name='ring_out')
    torus(0.066, 0.004, 'accent', (0, 0.02, 0.036), name='dome_ring')
    # четыре пилона соединяют внешнее кольцо с корпусом
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        p = box(0.007, 0.055, 0.007, 'dark',
                (math.cos(a) * 0.135, math.sin(a) * 0.14, -0.004), bevel=0.001, name=f'pyl_{i}')
        p.rotation_euler.z = a + math.pi / 2
    # тройка шпилей, центральный выше
    for i, (x, h) in enumerate(((0, 0.16), (-0.052, 0.10), (0.052, 0.10))):
        cone(0.010, h, 'hull', (x, -0.02, h / 2 + 0.03), axis='Z', verts=8, name=f'spire_{i}')
        torus(0.013, 0.0028, 'accent', (x, -0.02, 0.045), name=f'spire_ring_{i}')
        sphere(0.0065, 'glow', (x, -0.02, h + 0.036), seg=10, rings=8, name=f'tip_{i}')
    # киль-кристалл и носовой алтарь-фонарь
    cone(0.02, 0.09, 'glow', (0, 0.02, -0.075), axis='-Z', verts=6, name='keel')
    sphere(0.012, 'glow', (0, 0.155, 0.006), seg=12, rings=8, name='altar')
    _scale_all(1.60)


# ---------------------------------------------------------------------------
# Терминиды: живые споровозы — бугристый хитин, мандибулы, мембранные крылья,
# светящееся брюхо, жало.
# ---------------------------------------------------------------------------

def trm_destroyer():
    b = sphere(0.075, 'organic', (0, 0, 0), scale=(1, 1.55, 0.62), seg=28, rings=18,
               name='body')
    lumpy(b, 0.010, 0.07)
    h = sphere(0.045, 'organicDark', (0, 0.105, 0.004), seg=20, rings=14, name='head')
    lumpy(h, 0.008, 0.05)
    # мандибулы — две пары изогнутых жвал
    for s in (-1, 1):
        m1 = cone(0.010, 0.07, 'organicDark', (s * 0.026, 0.155, -0.004), axis='Y', verts=6,
                  name=f'mand_{s}')
        m1.rotation_euler.z = -s * 0.35
        m2 = cone(0.007, 0.05, 'organicDark', (s * 0.04, 0.14, 0.012), axis='Y', verts=6,
                  name=f'mand2_{s}')
        m2.rotation_euler.z = -s * 0.6
    # глаза
    for s in (-1, 1):
        sphere(0.009, 'accent', (s * 0.02, 0.14, 0.022), seg=10, rings=8, name=f'eye_{s}')
    # крылья-мембраны: тонкие лопасти, размах наружу-назад
    for s in (-1, 1):
        box(0.05, 0.13, 0.007, 'organicDark', (s * 0.125, -0.05, 0.004),
            rot=(0, 0, -s * 2.0), taper=0.2, bevel=0.001, name=f'wing_{s}')
    # спинные шипы
    for k in range(3):
        cone(0.009, 0.045 - k * 0.008, 'organicDark', (0, 0.02 - k * 0.05, 0.05), axis='Z',
             verts=5, name=f'spine_{k}')
    # светящиеся споровые мешки на брюхе
    for k in range(3):
        sphere(0.011, 'glow', (0, 0.03 - k * 0.045, -0.042), seg=10, rings=8, name=f'sac_{k}')
    # хвост-жало
    t = cone(0.015, 0.09, 'organic', (0, -0.135, 0.004), axis='Y', back=True, verts=7,
             name='tail')
    t.rotation_euler.x -= 0.15  # наклон поверх поворота оси (не заменяя его)


def trm_dreadnought():
    trm_destroyer()
    # вторая пара крыльев — сильнее свёрнуты назад
    for s in (-1, 1):
        box(0.045, 0.11, 0.006, 'organicDark', (s * 0.105, -0.115, 0.01),
            rot=(0, 0, -s * 2.35), taper=0.25, bevel=0.001, name=f'wing2_{s}')
    # усиленный гребень
    for k in range(2):
        cone(0.011, 0.06, 'organicDark', (0, -0.01 - k * 0.05, 0.055), axis='Z', verts=5,
             name=f'crest_{k}')
    _scale_all(1.30)


def trm_battleship():
    # матка роя: раздутое брюхо-инкубатор, гребень, четыре крыла
    b = sphere(0.1, 'organic', (0, 0, 0), scale=(1.1, 1.6, 0.7), seg=32, rings=20, name='body')
    lumpy(b, 0.012, 0.09)
    belly = sphere(0.075, 'glow', (0, -0.01, -0.045), scale=(0.9, 1.25, 0.45), seg=20,
                   rings=14, name='belly')
    lumpy(belly, 0.006, 0.05)
    h = sphere(0.055, 'organicDark', (0, 0.15, 0.006), seg=22, rings=16, name='head')
    lumpy(h, 0.008, 0.05)
    for s in (-1, 1):
        m1 = cone(0.013, 0.085, 'organicDark', (s * 0.032, 0.21, -0.004), axis='Y', verts=6,
                  name=f'mand_{s}')
        m1.rotation_euler.z = -s * 0.35
        sphere(0.011, 'accent', (s * 0.025, 0.185, 0.028), seg=10, rings=8, name=f'eye_{s}')
    # гребень шипов вдоль спины (убывающий)
    for k in range(5):
        cone(0.014 - k * 0.0015, 0.075 - k * 0.011, 'organicDark',
             (0, 0.07 - k * 0.055, 0.062 - k * 0.006), axis='Z', verts=5, name=f'crest_{k}')
    # две пары крыльев — тонкие лопасти с разным свесом
    for s in (-1, 1):
        box(0.06, 0.17, 0.008, 'organicDark', (s * 0.16, -0.02, 0.006),
            rot=(0, 0, -s * 1.95), taper=0.2, bevel=0.001, name=f'wingA_{s}')
        box(0.05, 0.13, 0.007, 'organicDark', (s * 0.13, -0.14, 0.012),
            rot=(0, 0, -s * 2.4), taper=0.25, bevel=0.001, name=f'wingB_{s}')
    # выводковые мешки по бокам брюха
    for s in (-1, 1):
        for k in range(3):
            sphere(0.012, 'glow', (s * 0.055, 0.04 - k * 0.055, -0.05), seg=10, rings=8,
                   name=f'sac_{s}_{k}')
    # жало из двух сегментов
    t1 = cone(0.02, 0.1, 'organic', (0, -0.19, 0.01), axis='Y', back=True, verts=7, name='tail1')
    t1.rotation_euler.x -= 0.12
    cone(0.008, 0.05, 'organicDark', (0, -0.245, 0.024), axis='Y', back=True, verts=6,
         name='tail2')
    _scale_all(1.55)


# ---------------------------------------------------------------------------
# Орбитальная станция (общая для всех фракций; красится акцентом).
# ---------------------------------------------------------------------------

def station():
    sphere(0.115, 'dark', (0, 0, 0), seg=28, rings=20, name='core')
    sphere(0.05, 'hull', (0, 0, 0.1), scale=(1, 1, 0.6), seg=18, rings=12, name='cap')
    torus(0.165, 0.013, 'hull', (0, 0, 0), name='ring_hull')
    torus(0.165, 0.005, 'accent', (0, 0, 0.017), name='ring_glow')
    # четыре пилона к кольцу
    for i in range(4):
        a = i * math.pi / 2
        p = box(0.012, 0.075, 0.02, 'dark', (math.cos(a) * 0.135, math.sin(a) * 0.135, 0),
                bevel=0.002, name=f'pyl_{i}')
        p.rotation_euler.z = a + math.pi / 2
    # тарелка связи на штанге + маяк
    cyl(0.003, 0.003, 0.05, 'dark', (0, 0.135, 0.05), axis='Y', verts=8, name='boom')
    c = cone(0.032, 0.02, 'hull', (0, 0.165, 0.05), axis='Y', verts=16, name='dish')
    sphere(0.006, 'glow', (0, 0.175, 0.05), seg=10, rings=8, name='dish_tip')
    void = c  # noqa: F841 — имя для читаемости
    # солнечные панели
    for s in (-1, 1):
        box(0.09, 0.032, 0.004, 'glow', (s * 0.23, 0, 0), bevel=0.001, name=f'panel_{s}')
        cyl(0.004, 0.004, 0.045, 'dark', (s * 0.19, 0, 0), axis='X', verts=8, name=f'strut_{s}')
    # пояс светящихся иллюминаторов
    torus(0.116, 0.0035, 'glow', (0, 0, -0.02), name='windows')


# ---------------------------------------------------------------------------
# Сборка, превью, экспорт
# ---------------------------------------------------------------------------

SHIPS = {
    'se_destroyer': se_destroyer, 'se_dreadnought': se_dreadnought, 'se_battleship': se_battleship,
    'aut_destroyer': aut_destroyer, 'aut_dreadnought': aut_dreadnought, 'aut_battleship': aut_battleship,
    'ill_destroyer': ill_destroyer, 'ill_dreadnought': ill_dreadnought, 'ill_battleship': ill_battleship,
    'trm_destroyer': trm_destroyer, 'trm_dreadnought': trm_dreadnought, 'trm_battleship': trm_battleship,
    'station': station,
}


def _scale_all(f: float):
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.matrix_world = Matrix.Scale(f, 4) @ o.matrix_world


def reset_scene(accent_key: str):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MAT_SPECS['accent'] = dict(MAT_SPECS['accent'])
    c = ACCENTS.get(accent_key, ACCENTS['se'])
    MAT_SPECS['accent']['color'] = c
    MAT_SPECS['accent']['emitc'] = c


def setup_preview(name: str):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 40
    sc.cycles.use_denoising = True
    sc.cycles.device = 'CPU'
    sc.render.resolution_x = 640
    sc.render.resolution_y = 440
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'  # честные цвета эмиссии в превью
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.008, 0.010, 0.016, 1)
    sc.world = w
    # трёхточечный свет
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(55), 0, math.radians(35)))
    bpy.context.object.data.energy = 3.5
    bpy.ops.object.light_add(type='AREA', location=(-0.6, -0.3, 0.4))
    bpy.context.object.data.energy = 30
    bpy.context.object.data.size = 0.8
    bpy.context.object.rotation_euler = (math.radians(-35), math.radians(-40), 0)
    bpy.ops.object.light_add(type='AREA', location=(0.2, -0.7, -0.35))
    bpy.context.object.data.energy = 18
    bpy.context.object.data.size = 0.9
    bpy.context.object.rotation_euler = (math.radians(120), 0, math.radians(-15))


def render_previews(name: str, out_dir: str):
    setup_preview(name)
    sc = bpy.context.scene
    bpy.ops.object.camera_add()
    cam = bpy.context.object
    cam.data.lens = 60
    sc.camera = cam
    # рамка модели
    import numpy as np  # noqa: F401 — bpy тянет numpy, но он не нужен напрямую
    xs, ys, zs = [], [], []
    for o in sc.objects:
        if o.type == 'MESH':
            for corner in o.bound_box:
                v = o.matrix_world @ Matrix.Translation(corner).to_translation()
                xs.append(v.x); ys.append(v.y); zs.append(v.z)
    span = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    d = span * 1.7
    views = {
        'hero': (d * 0.75, -d * 0.9, d * 0.55),
        'side': (d * 1.25, 0, d * 0.2),
        'top':  (0.001, -d * 0.35, d * 1.3),
    }
    for tag, pos in views.items():
        cam.location = pos
        direction = -cam.location
        cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(out_dir, f'{name}_{tag}.png')
        bpy.ops.render.render(write_still=True)


def export_glb(path: str):
    # Разворот: нос из +Y (Blender) в +Z (glTF)
    rot = Matrix.Rotation(math.pi, 4, 'Z')
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and o.parent is None:
            o.matrix_world = rot @ o.matrix_world
    for o in bpy.context.scene.objects:
        o.select_set(o.type == 'MESH')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True, export_animations=False,
        export_skins=False, export_morph=False, export_cameras=False, export_lights=False,
    )


def tri_count() -> int:
    total = 0
    deps = bpy.context.evaluated_depsgraph_get()
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            me = o.evaluated_get(deps).to_mesh()
            me.calc_loop_triangles()
            total += len(me.loop_triangles)
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='src/assets/ships')
    ap.add_argument('--previews', default='')
    ap.add_argument('--only', default='')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    if args.previews:
        os.makedirs(args.previews, exist_ok=True)
    wanted = [s for s in args.only.split(',') if s] or list(SHIPS)
    for name in wanted:
        build = SHIPS[name]
        reset_scene(name.split('_')[0])
        build()
        tris = tri_count()
        if args.previews:
            render_previews(name, args.previews)
        path = os.path.join(args.out, f'{name}.glb')
        export_glb(path)
        kb = os.path.getsize(path) / 1024
        print(f'[shipforge] {name}: {tris} tris, {kb:.0f} KB -> {path}')


if __name__ == '__main__':
    main()
