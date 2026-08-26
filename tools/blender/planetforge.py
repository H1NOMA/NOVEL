# -*- coding: utf-8 -*-
"""Кузница миров: рельефные сферы, кольца газовых гигантов и луны (Blender).

Запуск:  python3 tools/blender/planetforge.py --out src/assets/planets [--previews DIR]

Зачем это нужно. Раньше планета была идеальным шаром: весь рельеф жил только
в цвете фрагментного шейдера, поэтому на лимбе планета оставалась circle-perfect.
Здесь Blender вытесняет настоящую геометрию — горные пояса, кратерные поля,
дюны, ледяные разломы, лавовые борозды — и на просвет у мира появляется
изрезанный силуэт, а свет ложится по настоящим нормалям.

Вариативность не страдает: цвет по-прежнему считает шейдер из seed планеты,
а меш подбирается по биому и seed'у, плюс у каждого мира свой наклон и вращение.

Оси: экспорт в glTF (Y — вверх), как и у кораблей.
"""
import argparse
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shipforge as sf  # noqa: E402


# ---------------------------------------------------------------------------
# Рельефные сферы
# ---------------------------------------------------------------------------

def _noise_tex(name, kind, size, depth=2, intensity=1.0, contrast=1.0, brightness=0.5):
    """Процедурная текстура для Displace. Координаты берём GLOBAL — тогда
    рельеф бесшовный: он не зависит от UV-развёртки и полюсов не рвёт."""
    tex = bpy.data.textures.get(name)
    if tex:
        return tex
    tex = bpy.data.textures.new(name, kind)
    if kind == 'CLOUDS':
        tex.noise_scale = size
        tex.noise_depth = depth
        tex.noise_basis = 'BLENDER_ORIGINAL'
    elif kind == 'VORONOI':
        tex.noise_scale = size
        tex.distance_metric = 'DISTANCE'
        tex.color_mode = 'INTENSITY'
    elif kind == 'MUSGRAVE':
        tex.noise_scale = size
    tex.intensity = intensity
    tex.contrast = contrast
    return tex


def _displace(obj, tex, strength, mid=0.5):
    md = obj.modifiers.new(f'disp_{tex.name}', 'DISPLACE')
    md.texture = tex
    md.strength = strength
    md.mid_level = mid
    md.texture_coords = 'GLOBAL'
    return md


def _sphere(seg, rings):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1.0)
    o = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    o.data.materials.append(sf.mat('hull'))
    return o


def relief_mountain():
    """Материковые пояса: крупные плиты + острые хребты поверх."""
    o = _sphere(112, 76)
    _displace(o, _noise_tex('m_base', 'CLOUDS', 0.55, depth=3), 0.075)
    _displace(o, _noise_tex('m_ridge', 'CLOUDS', 0.18, depth=5, contrast=1.6), 0.032)
    return o


def relief_crater():
    """Кратерные поля: ячейки Вороного дают чаши и валы."""
    o = _sphere(112, 76)
    _displace(o, _noise_tex('c_cells', 'VORONOI', 0.32), -0.055)
    _displace(o, _noise_tex('c_fine', 'VORONOI', 0.13), -0.024)
    _displace(o, _noise_tex('c_base', 'CLOUDS', 0.7, depth=2), 0.022)
    return o


def relief_dune():
    """Дюнные моря: длинные пологие валы одной ориентации."""
    o = _sphere(104, 70)
    _displace(o, _noise_tex('d_wave', 'CLOUDS', 0.9, depth=2), 0.05)
    t = _noise_tex('d_fine', 'CLOUDS', 0.10, depth=2)
    md = _displace(o, t, 0.02)
    # растянуть мелкий шум в полосы — получаются гребни дюн
    md.texture_coords = 'GLOBAL'
    o.scale = (1, 1, 1)
    return o


def relief_fracture():
    """Ледяные разломы: острые грани плит, глубокие трещины."""
    o = _sphere(112, 76)
    # амплитуду держим в пределах ~8%: сильнее — и мир превращается в картофелину
    _displace(o, _noise_tex('f_plate', 'VORONOI', 0.42, intensity=1.2, contrast=2.2), 0.026)
    _displace(o, _noise_tex('f_crack', 'VORONOI', 0.16, contrast=2.6), -0.014)
    return o


def relief_volcanic():
    """Вулканический хаос: борозды, конусы, обрушенные кальдеры."""
    o = _sphere(112, 76)
    _displace(o, _noise_tex('v_base', 'CLOUDS', 0.42, depth=4, contrast=1.4), 0.085)
    _displace(o, _noise_tex('v_cald', 'VORONOI', 0.22), -0.038)
    _displace(o, _noise_tex('v_fine', 'CLOUDS', 0.09, depth=5), 0.022)
    return o


def relief_smooth():
    """Океанические и газовые миры: почти шар, лишь мягкая зыбь."""
    o = _sphere(96, 64)
    _displace(o, _noise_tex('s_swell', 'CLOUDS', 1.1, depth=2), 0.022)
    return o


def relief_canyon():
    """Каньоны: длинные глубокие русла, прорезающие плато."""
    o = _sphere(112, 76)
    _displace(o, _noise_tex('k_plate', 'CLOUDS', 0.62, depth=2), 0.048)
    # Узкие борозды: Вороного с высоким контрастом вырезает русла, а не ямы.
    _displace(o, _noise_tex('k_gorge', 'VORONOI', 0.30, intensity=1.4, contrast=3.0), -0.052)
    _displace(o, _noise_tex('k_fine', 'CLOUDS', 0.11, depth=4), 0.016)
    return o


def relief_archipelago():
    """Архипелаги: мелководные шельфы и россыпь островных дуг."""
    o = _sphere(104, 70)
    _displace(o, _noise_tex('a_shelf', 'CLOUDS', 0.85, depth=3), 0.030)
    _displace(o, _noise_tex('a_isles', 'CLOUDS', 0.24, depth=5, contrast=2.2), 0.038)
    _displace(o, _noise_tex('a_ripple', 'CLOUDS', 0.07, depth=2), 0.010)
    return o


def relief_shard():
    """Осколочный мир: угловатые грани, будто планету собрали из обломков."""
    o = _sphere(96, 64)
    _displace(o, _noise_tex('h_facet', 'VORONOI', 0.55, intensity=1.5, contrast=2.8), 0.062)
    _displace(o, _noise_tex('h_chip', 'VORONOI', 0.20, contrast=2.4), -0.028)
    return o


def relief_mesa():
    """Столовые горы: широкие плоские плато с обрывистыми краями."""
    o = _sphere(112, 76)
    # Высокий контраст на крупном шуме даёт «ступени» вместо плавных холмов.
    _displace(o, _noise_tex('t_mesa', 'CLOUDS', 0.48, depth=2, contrast=3.2), 0.058)
    _displace(o, _noise_tex('t_step', 'VORONOI', 0.38, contrast=2.0), 0.020)
    _displace(o, _noise_tex('t_grit', 'CLOUDS', 0.09, depth=3), 0.012)
    return o


def relief_basin():
    """Древние бассейны: огромные пологие впадины и валы вокруг них."""
    o = _sphere(104, 70)
    _displace(o, _noise_tex('b_basin', 'VORONOI', 0.72, intensity=1.1), -0.060)
    _displace(o, _noise_tex('b_rim', 'CLOUDS', 0.34, depth=3), 0.028)
    _displace(o, _noise_tex('b_dust', 'CLOUDS', 0.12, depth=2), 0.010)
    return o


def relief_storm():
    """Газовые гиганты: широкие полосы облаков и вихревые пятна."""
    o = _sphere(96, 64)
    _displace(o, _noise_tex('g_band', 'CLOUDS', 1.4, depth=2), 0.026)
    _displace(o, _noise_tex('g_eddy', 'CLOUDS', 0.30, depth=4, contrast=1.5), 0.016)
    return o


RELIEFS = {
    'mountain': relief_mountain,
    'crater': relief_crater,
    'dune': relief_dune,
    'fracture': relief_fracture,
    'volcanic': relief_volcanic,
    'smooth': relief_smooth,
    'canyon': relief_canyon,
    'archipelago': relief_archipelago,
    'shard': relief_shard,
    'mesa': relief_mesa,
    'basin': relief_basin,
    'storm': relief_storm,
}


# ---------------------------------------------------------------------------
# Кольца газовых гигантов и луны
# ---------------------------------------------------------------------------

def ring():
    """Плоское кольцо из концентрических полос — для газовых гигантов.

    Полосы строятся напрямую из квадов между двумя радиусами: булев вырез по
    плоским n-gon'ам ненадёжен (нулевая толщина — не замкнутый объём) и даёт
    вместо кольца сплошной диск. Разрывы между полосами читаются как щели
    Кассини. Кольцо лежит в плоскости XY (в glTF станет горизонтальным).
    """
    import bmesh as bm
    bands = [
        (1.32, 1.52), (1.56, 1.71), (1.75, 1.80), (1.84, 2.06), (2.11, 2.18),
    ]
    seg = 160
    mesh = bpy.data.meshes.new('rings')
    b = bm.new()
    for r0, r1 in bands:
        prev = None
        first = None
        for i in range(seg + 1):
            a = i * 2 * math.pi / seg
            ca, sa = math.cos(a), math.sin(a)
            vi = b.verts.new((ca * r0, sa * r0, 0.0))
            vo = b.verts.new((ca * r1, sa * r1, 0.0))
            if prev is not None:
                b.faces.new((prev[0], prev[1], vo, vi))
            prev = (vi, vo)
            if first is None:
                first = (vi, vo)
        b.faces.new((prev[0], prev[1], first[1], first[0]))
    b.to_mesh(mesh)
    b.free()
    o = bpy.data.objects.new('rings', mesh)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(sf.mat('hull'))
    return o


def moon():
    """Луна-обломок: побитый кратерами неправильный шар."""
    o = _sphere(64, 44)
    _displace(o, _noise_tex('mn_shape', 'CLOUDS', 1.4, depth=2), 0.16)
    _displace(o, _noise_tex('mn_crater', 'VORONOI', 0.30), -0.07)
    _displace(o, _noise_tex('mn_fine', 'CLOUDS', 0.16, depth=3), 0.03)
    return o


def asteroid():
    """Астероид пояса: грубая колотая глыба."""
    o = _sphere(40, 28)
    _displace(o, _noise_tex('as_shape', 'CLOUDS', 1.8, depth=2), 0.34)
    _displace(o, _noise_tex('as_chip', 'VORONOI', 0.45, contrast=1.8), -0.13)
    return o


EXTRAS = {
    'ring': ring,
    'moon': moon,
    'asteroid': asteroid,
}


# ---------------------------------------------------------------------------
# Сборка
# ---------------------------------------------------------------------------

def export_glb(path: str, apply_mods: bool = True) -> None:
    for o in bpy.context.scene.objects:
        o.select_set(o.type == 'MESH')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=apply_mods, export_yup=True, export_animations=False,
        export_skins=False, export_morph=False, export_cameras=False, export_lights=False,
        # нормали и UV не пишем: three.js считает нормали сам, а текстур нет —
        # это срезает треть веса GLB
        export_normals=False, export_texcoords=False, export_materials='NONE',
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
    ap.add_argument('--out', default='src/assets/planets')
    ap.add_argument('--only', default='')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    jobs = {**RELIEFS, **EXTRAS}
    wanted = [n for n in args.only.split(',') if n] or list(jobs)
    for name in wanted:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        jobs[name]()
        tris = tri_count()
        path = os.path.abspath(os.path.join(args.out, f'{name}.glb'))
        export_glb(path)
        kb = os.path.getsize(path) / 1024
        print(f'[planetforge] {name}: {tris} tris, {kb:.0f} KB -> {path}')


if __name__ == '__main__':
    main()
