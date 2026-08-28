import { Effect } from '@babylonjs/core/Materials/effect';

// ---------------------------------------------------------------------------
// Поверхность корпусов: кораблей, станций и планетарных сооружений.
//
// До этого корабль был ровно закрашенным куском металла: PBR-материал с одним
// цветом на весь корпус. У планет к этому моменту были девять октав шума,
// хребты, эрозия и разворот нормали по высоте, а у флота — заливка. На общем
// плане разницы не видно, но стоит подлететь, и корабль выглядит игрушкой
// рядом с проработанным миром.
//
// Здесь корпус получает своё: обшивку из панелей со швами, заклёпки по швам,
// потёртости на кромках, копоть в углублениях и honest-металл в освещении.
// Всё процедурное и БЕЗ РАЗВЁРТКИ: модели из Blender не имеют осмысленных UV,
// поэтому узор берётся трипланарной проекцией по координатам самой модели —
// тем же приёмом, которым планета берёт шум по направлению из центра.
//
// Солнце то же, что у планет (uSun): корабль на орбите обязан быть освещён с
// той же стороны, что и мир под ним, иначе карта разваливается на два
// несогласованных источника света.
// ---------------------------------------------------------------------------

const HULL_NOISE = /* glsl */ `
// Дешёвый хеш-шум: корпусу не нужен симплекс, ему нужны грязь и потёртости.
// Три октавы этого стоят на порядок меньше, чем одна октава симплекса, а на
// металле разницы не видно.
float hash13(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x){
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
                 mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                 mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p){
  return vnoise(p) * 0.55 + vnoise(p * 2.07) * 0.3 + vnoise(p * 4.13) * 0.15;
}

/**
 * Шов обшивки по одной оси.
 *
 * Панели разного размера: ровная сетка читается как миллиметровка, а не как
 * броня. Ширина шва задана в долях периода и гаснет вместе с различимостью —
 * на корабле в десяток пикселей швы превратились бы в мерцающую рябь.
 */
float seam(float v, float period, float width, float fw){
  float c = abs(fract(v / period - 0.5) - 0.5) * 2.0 * period;
  float line = 1.0 - smoothstep(width, width * 2.2, c);
  return line * (1.0 - smoothstep(0.35, 1.0, fw / period));
}
`;

const HULL_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 worldViewProjection;
uniform mat4 world;
varying vec3 vObj;
varying vec3 vWorldN;
varying vec3 vWorldP;
void main(){
  // Узор берётся в координатах МОДЕЛИ, а не мира: иначе обшивка «плыла» бы по
  // корпусу, когда корабль летит и поворачивается.
  vObj = position;
  vWorldN = normalize(mat3(world) * normal);
  vWorldP = (world * vec4(position, 1.0)).xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const HULL_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uBase;        // цвет обшивки
uniform vec3 uAccent;      // фракционный цвет: полосы и маркировка
uniform vec3 uSun;
uniform vec3 cameraPosition;
uniform float uMetal;      // металличность 0…1
uniform float uRough;      // шероховатость 0…1
uniform float uEmissive;   // сила собственного свечения (ходовые огни)
uniform float uPanel;      // масштаб обшивки: крупные плиты или мелкие
uniform float uWear;       // насколько корпус потрёпан
uniform float uOrganic;    // 1 — хитин роя вместо металла
varying vec3 vObj;
varying vec3 vWorldN;
varying vec3 vWorldP;
${HULL_NOISE}
void main(){
  vec3 nrm = normalize(vWorldN);
  vec3 vd = normalize(cameraPosition - vWorldP);
  vec3 sun = normalize(uSun);
  // Размер пикселя на поверхности — им гасятся швы и заклёпки, когда корабль
  // становится мелким.
  float fw = fwidth(vObj.x) + fwidth(vObj.y) + fwidth(vObj.z);

  vec3 col = uBase;

  if (uOrganic < 0.5) {
    // --- Обшивка ------------------------------------------------------------
    // Швы идут по трём осям с разными периодами: сетка с одинаковым шагом
    // читается как миллиметровка, а не как набранная из плит броня.
    float s = seam(vObj.x, uPanel, uPanel * 0.035, fw)
            + seam(vObj.y, uPanel * 0.62, uPanel * 0.03, fw)
            + seam(vObj.z, uPanel * 1.37, uPanel * 0.04, fw);
    s = clamp(s, 0.0, 1.0);
    // Шов — это щель: она темнее плиты и собирает в себе грязь.
    col *= 1.0 - s * 0.45;

    // Плиты слегка разного оттенка — обшивку варили из разных партий металла.
    vec3 cell = floor(vObj / vec3(uPanel, uPanel * 0.62, uPanel * 1.37));
    col *= 0.9 + 0.2 * hash13(cell);

    // Заклёпки вдоль швов: видны только вблизи, дальше гаснут вместе со швом.
    float rivet = step(0.86, hash13(floor(vObj / (uPanel * 0.18))));
    col += vec3(0.10) * rivet * s * (1.0 - smoothstep(0.02, 0.09, fw));

    // --- Износ --------------------------------------------------------------
    // Потёртости на выступающих местах: где корпус ловит всё подряд, краска
    // сходит первой и обнажает светлый металл.
    float edge = pow(1.0 - abs(dot(nrm, vd)), 2.0);
    float scuff = fbm3(vObj * (14.0 / max(uPanel, 0.02)));
    col = mix(col, vec3(0.62, 0.64, 0.67), smoothstep(0.55, 0.95, scuff) * uWear * (0.35 + edge * 0.5));
    // Копоть в углублениях и на нижней полусфере — там, где не отмывают.
    float grime = fbm3(vObj * (6.0 / max(uPanel, 0.02)) + 31.0);
    col *= 1.0 - smoothstep(0.5, 0.9, grime) * uWear * 0.3;

    // Фракционная полоса по борту: узкая, вдоль корпуса, с рваной кромкой.
    float band = 1.0 - smoothstep(0.012, 0.03, abs(vObj.y - 0.006) + fbm3(vObj * 24.0) * 0.008);
    col = mix(col, uAccent, band * 0.55);
  } else {
    // --- Хитин роя ----------------------------------------------------------
    // У терминидов не обшивка, а панцирь: сегменты поперёк тела, между ними
    // мягкие складки, поверхность неровная и матовая.
    float seg = sin(vObj.z * (36.0 / max(uPanel, 0.02)) + fbm3(vObj * 8.0) * 2.0);
    col *= 0.82 + 0.18 * smoothstep(-0.2, 0.9, seg);
    float pores = fbm3(vObj * (30.0 / max(uPanel, 0.02)));
    col *= 0.88 + 0.24 * pores;
    col = mix(col, uAccent, smoothstep(0.72, 0.95, pores) * 0.4);
  }

  // --- Освещение ------------------------------------------------------------
  // Солнце то же, что у планет: корабль на орбите обязан быть освещён с той же
  // стороны, что и мир под ним.
  float ndl = dot(nrm, sun);
  float diff = clamp((ndl + 0.18) / 1.18, 0.0, 1.0);
  // Полусферный ambient: холодное небо сверху, тёплый отсвет диска снизу — тот
  // же, что у поверхности миров, иначе флот выглядит вырезанным из другой сцены.
  vec3 ambient = mix(vec3(0.052, 0.046, 0.042), vec3(0.070, 0.086, 0.118), nrm.y * 0.5 + 0.5);
  vec3 lit = col * (ambient + vec3(1.0, 0.965, 0.90) * diff);

  // Блик: у металла узкий и цветной от самого металла, у хитина широкий и белёсый.
  vec3 h = normalize(sun + vd);
  float gloss = mix(12.0, 90.0, 1.0 - uRough);
  float spec = pow(clamp(dot(nrm, h), 0.0, 1.0), gloss);
  vec3 specCol = mix(vec3(1.0), col, uMetal);
  lit += specCol * spec * (0.25 + 0.75 * uMetal) * (1.0 - uRough) * 1.6;

  // Контровой ободок: без него тёмный корпус на чёрном космосе теряет силуэт.
  float rim = pow(1.0 - clamp(dot(nrm, vd), 0.0, 1.0), 3.5);
  lit += mix(vec3(0.30, 0.40, 0.62), uAccent, 0.45) * rim * 0.5;

  // Собственное свечение — ходовые огни и разогретые сопла.
  lit += uAccent * uEmissive;

  gl_FragColor = vec4(lit, 1.0);
}
`;

Effect.ShadersStore['hullVertexShader'] = HULL_VERT;
Effect.ShadersStore['hullFragmentShader'] = HULL_FRAG;

export const HULL_ATTRS = ['position', 'normal'];
export const HULL_UNIFORMS = [
  'worldViewProjection', 'world', 'cameraPosition',
  'uBase', 'uAccent', 'uSun', 'uMetal', 'uRough', 'uEmissive', 'uPanel', 'uWear', 'uOrganic',
];
