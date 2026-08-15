# -*- coding: utf-8 -*-
"""Фон главного меню: панорама фронта Второй Галактической (Blender/Cycles).

Запуск:  python3 tools/blender/menuart.py --out src/assets/menubg.webp [--fast]

Кадр строится под интерфейс: слева и по центру — глубокий космос, чтобы
поверх легли заголовок и кнопки; вся тяжесть композиции уходит вправо —
силуэт линкора Супер-Земли на фоне подсвеченной планеты, за ним эскадра,
дальше — зарево орбитального боя. Внизу полоса тьмы под нижние подписи.
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shipforge as sf  # noqa: E402
import keyart as ka  # noqa: E402


def emissive(name, color, strength):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0, 0, 0, 1)
    b.inputs['Emission Color'].default_value = color
    b.inputs['Emission Strength'].default_value = strength
    return m


def battle_flash(at, r, color, strength):
    """Далёкая вспышка орбитального боя — светящийся шар без геометрии сцены."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=12, radius=r, location=at)
    o = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    o.data.materials.append(emissive(f'flash_{color[0]:.2f}_{r:.3f}', color, strength))
    return o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='src/assets/menubg.webp')
    ap.add_argument('--fast', action='store_true')
    args = ap.parse_args()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene

    # --- флот Супер-Земли справа ---------------------------------------------
    sf.MAT_SPECS['accent'] = dict(sf.MAT_SPECS['accent'])
    sf.MAT_SPECS['accent']['color'] = sf.ACCENTS['se']
    sf.MAT_SPECS['accent']['emitc'] = sf.ACCENTS['se']

    focus = Vector((-3.4, 6.0, 0.35))
    flag = ka.build_ship(sf.se_battleship, 'flag')
    flag.location = (0.72, 1.30, 0.26)
    flag.scale = (1.55, 1.55, 1.55)
    ka.aim(flag, focus)
    flag.rotation_euler.y = 0.10

    escort = [
        (sf.se_dreadnought, (1.70, 3.10, -0.35), 0.80),
        (sf.se_destroyer, (0.65, 3.60, 0.95), 0.52),
        (sf.se_destroyer, (2.30, 5.00, 0.35), 0.40),
    ]
    for i, (builder, loc, s) in enumerate(escort):
        o = ka.build_ship(builder, f'esc{i}')
        o.location = loc
        o.scale = (s, s, s)
        ka.aim(o, focus)

    # --- враг вдалеке и перестрелка ------------------------------------------
    if 'accent' in bpy.data.materials:
        bpy.data.materials['accent'].name = 'accent_se'
    sf.MAT_SPECS['accent'] = dict(sf.MAT_SPECS['accent'])
    sf.MAT_SPECS['accent']['color'] = sf.ACCENTS['aut']
    sf.MAT_SPECS['accent']['emitc'] = sf.ACCENTS['aut']
    for i, (loc, s) in enumerate((((-2.10, 6.3, 0.75), 0.30), ((-3.05, 7.4, -0.20), 0.24))):
        e = ka.build_ship(sf.aut_destroyer, f'aut{i}')
        e.location = loc
        e.scale = (s, s, s)
        ka.aim(e, Vector((1.6, 0.5, -0.15)))

    ka.beam((0.95, 2.15, 0.42), (-2.00, 6.15, 0.72), 'yel')
    ka.beam((-2.05, 6.2, 0.73), (2.05, 3.2, -0.30), 'red')
    # Далёкие вспышки: мелкие и яркие — читаются как всполохи боя, а не шары.
    for at, r, c, st in (
        ((-2.05, 6.25, 0.70), 0.05, (1, 0.45, 0.12, 1), 45),
        ((-4.6, 9.8, -0.85), 0.07, (1, 0.30, 0.08, 1), 16),
        ((-6.0, 12.2, 1.15), 0.06, (1, 0.72, 0.25, 1), 10),
    ):
        battle_flash(at, r, c, st)

    # --- планета: большая, справа-сзади, подсвечена с фронта ------------------
    bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=88, radius=11.0,
                                         location=(12.6, 17.0, -6.4))
    p = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    m = bpy.data.materials.new('world')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexNoise')
    tex.inputs['Scale'].default_value = 2.2
    tex.inputs['Detail'].default_value = 10
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.46
    ramp.color_ramp.elements[0].color = (0.012, 0.030, 0.070, 1)   # океан
    ramp.color_ramp.elements[1].position = 0.58
    ramp.color_ramp.elements[1].color = (0.10, 0.20, 0.09, 1)      # суша
    e = ramp.color_ramp.elements.new(0.80)
    e.color = (0.40, 0.36, 0.26, 1)                                 # нагорья
    nt.links.new(tex.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.9
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.22
    nt.links.new(tex.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    p.data.materials.append(m)

    # тонкий атмосферный нимб
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=64, radius=11.30,
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
    emit.inputs['Color'].default_value = (0.32, 0.62, 1.0, 1)
    emit.inputs['Strength'].default_value = 2.6
    lw = ant.nodes.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.16
    r2 = ant.nodes.new('ShaderNodeValToRGB')
    r2.color_ramp.elements[0].position = 0.70
    r2.color_ramp.elements[1].position = 0.97
    ant.links.new(lw.outputs['Facing'], r2.inputs['Fac'])
    ant.links.new(r2.outputs['Color'], mix.inputs['Fac'])
    ant.links.new(transp.outputs[0], mix.inputs[1])
    ant.links.new(emit.outputs[0], mix.inputs[2])
    ant.links.new(mix.outputs[0], out.inputs['Surface'])
    am.blend_method = 'BLEND'
    atm.data.materials.append(am)

    ka.make_world()

    # --- свет ----------------------------------------------------------------
    # Главное солнце светит справа-сверху: планета получает узкий освещённый
    # серп, остальное уходит в тень — так кадр остаётся тёмным под интерфейс.
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(64), 0, math.radians(112)))
    bpy.context.object.data.energy = 4.2
    bpy.context.object.data.color = (1, 0.93, 0.82)
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(52), 0, math.radians(50)))
    bpy.context.object.data.energy = 0.5
    bpy.context.object.data.color = (0.5, 0.62, 1)
    bpy.ops.object.light_add(type='AREA', location=(3.2, -2.2, 1.9))
    key = bpy.context.object
    key.data.energy = 900
    key.data.size = 4.5
    key.data.color = (1, 0.87, 0.66)
    key.rotation_euler = (Vector((1.0, 0.6, -0.1)) - Vector(key.location)
                          ).to_track_quat('-Z', 'Y').to_euler()

    # --- камера: широкий кадр, флот справа, слева воздух под меню ------------
    # Точка взгляда смещена влево от флота — так корабли и планета уходят
    # в правую треть кадра, а слева остаётся тьма под заголовок и кнопки.
    bpy.ops.object.camera_add(location=(1.55, -4.60, 1.15))
    cam = bpy.context.object
    cam.data.lens = 30
    look = Vector((-1.85, 2.90, 0.20)) - Vector(cam.location)
    cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    cam.rotation_euler.rotate_axis('Z', math.radians(-1.5))
    sc.camera = cam

    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 28 if args.fast else 180
    sc.cycles.use_denoising = True
    sc.render.resolution_x = 960 if args.fast else 2560
    sc.render.resolution_y = 540 if args.fast else 1440
    sc.view_settings.view_transform = 'Filmic'
    sc.view_settings.look = 'Medium High Contrast'
    ext = os.path.splitext(args.out)[1].lower()
    sc.render.image_settings.file_format = {'.webp': 'WEBP', '.jpg': 'JPEG', '.png': 'PNG'}[ext]
    if ext in ('.webp', '.jpg'):
        sc.render.image_settings.quality = 88
    sc.render.filepath = os.path.abspath(args.out)
    bpy.ops.render.render(write_still=True)
    print(f'[menuart] -> {args.out} ({os.path.getsize(args.out) / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
