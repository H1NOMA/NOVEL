# -*- coding: utf-8 -*-
"""Ключевой арт для экрана выбора фракции: кинематографичный рендер Cycles.

Запуск:  python3 tools/blender/keyart.py --out src/assets/keyart.webp [--fast]

Сцена: флот Супер-Земли идёт к осаждённой планете, навстречу — корабли
автоматонов; перестрелка трассерами, звёздное небо с туманностью, рим-свет
от солнца за планетой. Модели кораблей — те же билдеры, что и в shipforge.py.
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shipforge as sf  # noqa: E402


def build_ship(builder, name: str):
    """Собрать корабль билдером и подвесить его объекты под пустышку-корень."""
    before = set(o.name for o in bpy.context.scene.objects)
    builder()
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for o in bpy.context.scene.objects:
        if o.name not in before and o.parent is None and o is not root:
            o.parent = root
    return root


def aim(obj, target: Vector):
    """Повернуть корабль носом (+Y) на цель (вокруг Z)."""
    d = target - Vector(obj.location)
    obj.rotation_euler = (0, 0, math.atan2(-d.x, d.y))


def beam(p1, p2, color, r=0.0035):
    """Светящийся трассер между двумя точками."""
    name = f'beam_{color}'
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        rgb = {'yel': (1, 0.75, 0.12, 1), 'red': (1, 0.16, 0.05, 1)}[color]
        b.inputs['Emission Color'].default_value = rgb
        b.inputs['Emission Strength'].default_value = 55
    a, bpt = Vector(p1), Vector(p2)
    mid = (a + bpt) / 2
    d = bpt - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=r, depth=d.length, location=mid)
    o = bpy.context.active_object
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    o.data.materials.append(m)
    return o


def make_planet():
    """Осаждённый мир: охристая суша, тёмные моря, атмосферная кромка."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=64, radius=1.15,
                                         location=(1.05, 2.6, -0.55))
    p = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    m = bpy.data.materials.new('planet')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexNoise')
    tex.inputs['Scale'].default_value = 2.7
    tex.inputs['Detail'].default_value = 9
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.5
    ramp.color_ramp.elements[0].color = (0.03, 0.035, 0.06, 1)    # тёмные моря
    ramp.color_ramp.elements[1].position = 0.63
    ramp.color_ramp.elements[1].color = (0.38, 0.26, 0.11, 1)     # охристая суша
    e = ramp.color_ramp.elements.new(0.85)
    e.color = (0.62, 0.55, 0.42, 1)                               # высокогорья
    nt.links.new(tex.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.25
    nt.links.new(tex.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    p.data.materials.append(m)
    # атмосферная кромка
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=48, radius=1.185,
                                         location=p.location)
    atm = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    am = bpy.data.materials.new('atmo')
    am.use_nodes = True
    ant = am.node_tree
    ant.nodes.clear()
    out = ant.nodes.new('ShaderNodeOutputMaterial')
    mix = ant.nodes.new('ShaderNodeMixShader')
    transp = ant.nodes.new('ShaderNodeBsdfTransparent')
    emit = ant.nodes.new('ShaderNodeEmission')
    emit.inputs['Color'].default_value = (0.45, 0.7, 1.0, 1)
    emit.inputs['Strength'].default_value = 1.6
    lw = ant.nodes.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.28
    ramp2 = ant.nodes.new('ShaderNodeValToRGB')
    ramp2.color_ramp.elements[0].position = 0.55
    ramp2.color_ramp.elements[1].position = 0.92
    ant.links.new(lw.outputs['Facing'], ramp2.inputs['Fac'])
    ant.links.new(ramp2.outputs['Color'], mix.inputs['Fac'])
    ant.links.new(transp.outputs[0], mix.inputs[1])
    ant.links.new(emit.outputs[0], mix.inputs[2])
    ant.links.new(mix.outputs[0], out.inputs['Surface'])
    am.blend_method = 'BLEND'
    atm.data.materials.append(am)
    return p


def make_world():
    """Звёздное небо: точечные звёзды + слабая пурпурная туманность."""
    w = bpy.data.worlds.new('space')
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    coord = nt.nodes.new('ShaderNodeTexCoord')
    # звёзды
    stars = nt.nodes.new('ShaderNodeTexNoise')
    stars.inputs['Scale'].default_value = 320
    stars.inputs['Detail'].default_value = 2
    sramp = nt.nodes.new('ShaderNodeValToRGB')
    sramp.color_ramp.elements[0].position = 0.795
    sramp.color_ramp.elements[1].position = 0.83
    nt.links.new(coord.outputs['Generated'], stars.inputs['Vector'])
    nt.links.new(stars.outputs['Fac'], sramp.inputs['Fac'])
    # туманность
    neb = nt.nodes.new('ShaderNodeTexNoise')
    neb.inputs['Scale'].default_value = 2.1
    neb.inputs['Detail'].default_value = 6
    nramp = nt.nodes.new('ShaderNodeValToRGB')
    nramp.color_ramp.elements[0].position = 0.4
    nramp.color_ramp.elements[0].color = (0.004, 0.005, 0.012, 1)
    nramp.color_ramp.elements[1].position = 0.75
    nramp.color_ramp.elements[1].color = (0.05, 0.02, 0.09, 1)
    nt.links.new(coord.outputs['Generated'], neb.inputs['Vector'])
    nt.links.new(neb.outputs['Fac'], nramp.inputs['Fac'])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'ADD'
    mix.inputs['Factor'].default_value = 1.0
    nt.links.new(nramp.outputs['Color'], mix.inputs['A'])
    nt.links.new(sramp.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0
    bpy.context.scene.world = w


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='src/assets/keyart.webp')
    ap.add_argument('--fast', action='store_true')
    args = ap.parse_args()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene

    # --- флот Супер-Земли (жёлтый акцент) ------------------------------------
    sf.MAT_SPECS['accent'] = dict(sf.MAT_SPECS['accent'])
    sf.MAT_SPECS['accent']['color'] = sf.ACCENTS['se']
    sf.MAT_SPECS['accent']['emitc'] = sf.ACCENTS['se']
    enemy_focus = Vector((0.9, 2.3, -0.35))
    flag = build_ship(sf.se_battleship, 'flag')
    flag.location = (-0.62, 0.15, 0.02)
    aim(flag, enemy_focus)
    d1 = build_ship(sf.se_destroyer, 'd1')
    d1.location = (-0.1, 0.72, 0.16)
    aim(d1, enemy_focus)
    d2 = build_ship(sf.se_destroyer, 'd2')
    d2.location = (-0.78, 1.05, -0.2)
    d2.scale = (0.72, 0.72, 0.72)
    aim(d2, enemy_focus)
    d3 = build_ship(sf.se_dreadnought, 'd3')
    d3.location = (-0.35, 1.25, 0.34)
    d3.scale = (0.62, 0.62, 0.62)
    aim(d3, enemy_focus)

    # --- автоматоны (красный акцент) у планеты -------------------------------
    if 'accent' in bpy.data.materials:
        bpy.data.materials['accent'].name = 'accent_se'
    sf.MAT_SPECS['accent'] = dict(sf.MAT_SPECS['accent'])
    sf.MAT_SPECS['accent']['color'] = sf.ACCENTS['aut']
    sf.MAT_SPECS['accent']['emitc'] = sf.ACCENTS['aut']
    for i, (loc, s) in enumerate((
        ((0.35, 1.75, -0.05), 0.5),
        ((0.8, 1.55, 0.18), 0.42),
        ((1.25, 1.95, -0.3), 0.55),
    )):
        e = build_ship(sf.aut_destroyer, f'aut{i}')
        e.location = loc
        e.scale = (s, s, s)
        aim(e, Vector((-0.6, 0.1, 0.05)))

    # --- перестрелка ---------------------------------------------------------
    beam((-0.05, 0.95, 0.16), (0.76, 1.52, 0.17), 'yel')
    beam((-0.55, 0.45, 0.03), (0.33, 1.68, -0.05), 'yel')
    beam((0.37, 1.68, -0.05), (-0.85, 0.95, -0.13), 'red')
    beam((1.22, 1.88, -0.29), (-0.05, 0.85, 0.14), 'red')

    make_planet()
    make_world()

    # --- свет: солнце за планетой (рим) + холодная подсветка + тёплый ключ ---
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(78), 0, math.radians(-160)))
    bpy.context.object.data.energy = 4.5
    bpy.context.object.data.color = (1, 0.92, 0.8)
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(60), 0, math.radians(35)))
    bpy.context.object.data.energy = 0.55
    bpy.context.object.data.color = (0.55, 0.65, 1)
    # тёплый ключ на флот СЗ слева-снизу от камеры
    bpy.ops.object.light_add(type='AREA', location=(-1.9, -0.4, 0.9))
    key = bpy.context.object
    key.data.energy = 260
    key.data.size = 2.6
    key.data.color = (1, 0.86, 0.62)
    key.rotation_euler = (Vector((-0.4, 0.6, 0.05)) - Vector(key.location)
                          ).to_track_quat('-Z', 'Y').to_euler()

    # --- камера --------------------------------------------------------------
    bpy.ops.object.camera_add(location=(-1.85, -1.55, 0.42))
    cam = bpy.context.object
    cam.data.lens = 42
    look = Vector((0.15, 1.35, -0.12)) - Vector(cam.location)
    cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    cam.rotation_euler.rotate_axis('Z', math.radians(-2.5))
    sc.camera = cam

    # --- рендер --------------------------------------------------------------
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 32 if args.fast else 160
    sc.cycles.use_denoising = True
    sc.render.resolution_x = 960 if args.fast else 1920
    sc.render.resolution_y = 540 if args.fast else 1080
    sc.view_settings.view_transform = 'Filmic'
    sc.view_settings.look = 'Medium High Contrast'
    ext = os.path.splitext(args.out)[1].lower()
    sc.render.image_settings.file_format = {'.webp': 'WEBP', '.jpg': 'JPEG', '.png': 'PNG'}[ext]
    if ext in ('.webp', '.jpg'):
        sc.render.image_settings.quality = 90
    sc.render.filepath = os.path.abspath(args.out)
    bpy.ops.render.render(write_still=True)
    print(f'[keyart] -> {args.out} ({os.path.getsize(args.out) / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
