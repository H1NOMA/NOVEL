import { Effect } from '@babylonjs/core/Materials/effect';

// ---------------------------------------------------------------------------
// Шейдеры поверхности миров и атмосферной оболочки.
//
// Фрагментные шейдеры перенесены с прежнего движка ДОСЛОВНО, до символа: это
// самое ценное, что есть в рендере, и трогать его при смене движка нельзя.
// Работает это потому, что Babylon принимает сырой GLSL ES 1.0 (gl_FragColor,
// texture2D) и сам подставляет cameraPosition, если тот перечислен в uniforms.
//
// Переписаны только ВЕРШИННЫЕ шейдеры, и ровно по одной причине: Babylon, в
// отличие от прежнего движка, не инъектирует ни атрибуты, ни матрицы. Поэтому
// position/normal объявлены явно, а projectionMatrix * viewMatrix * modelMatrix
// схлопнулось в готовые worldViewProjection и world.
// ---------------------------------------------------------------------------

// Ashima simplex noise (3D) + fbm, used to give every planet a unique,
// volumetric procedural surface instead of a flat sprite.
const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
/**
 * Сколько октав шума ИМЕЕТ СМЫСЛ считать в этом пикселе.
 *
 * Ставится один раз в main() и дальше действует на весь шум поверхности.
 * Верхняя граница — настройка качества и дистанция (uOct), нижняя — размер
 * пикселя: октаву, период которой уже, чем пиксель, считать не только
 * бесполезно, но и вредно — из неё рождается ползущая рябь.
 */
float gOct = 5.0;

float fbm(vec3 p){
  float f = 0.0; float amp = 0.5;
  // Октав восемь: «мыло» на поверхности было нехваткой верхних октав, но
  // девятая уже уходит под размер пикселя и даёт не резкость, а рябь. Реальное
  // их число режется и настройкой качества (uOct), и размером пикселя (gOct),
  // поэтому на общем плане считается по-прежнему пять-шесть.
  for(int i=0;i<8;i++){
    if (float(i) >= gOct) break;
    f += amp*snoise(p); p *= 2.07; amp *= 0.5;
  }
  return f;
}

/**
 * Ridged multifractal — хребты с ОСТРЫМ гребнем.
 *
 * Обычный fbm даёт мягкие холмы: сумма синусоподобного шума нигде не имеет
 * излома. Модуль с инверсией создаёт складку на нуле, и рельеф получает
 * чёткие кромки — то, чего поверхностям не хватало больше всего.
 */
float ridged(vec3 p, float oct){
  float f = 0.0; float amp = 0.5; float prev = 1.0;
  for(int i=0;i<6;i++){
    if (float(i) >= oct) break;
    float n = 1.0 - abs(snoise(p));
    n *= n;
    f += n * amp * prev;
    prev = n;
    p *= 2.13; amp *= 0.5;
  }
  return f;
}

/** Одна октава высокой частоты: зерно поверхности, «кожа» планеты. */
float grit(vec3 p){
  return snoise(p) * 0.5 + 0.5;
}

/**
 * Насколько уместна деталь такой частоты в этом пикселе.
 *
 * Мелкое зерно даёт резкость ровно до того момента, пока период узора шире
 * пикселя. Дальше начинается муар: планета в двадцать пикселей покрывается
 * шевелящейся «солью с перцем», и это хуже любого мыла. fwidth говорит,
 * сколько поверхности приходится на пиксель, — и деталь плавно гаснет ровно
 * там, где её всё равно не разрешить.
 */
float band(float freq, float fw){
  return 1.0 - smoothstep(0.30, 0.90, fw * freq);
}
`;

const VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 worldViewProjection;
uniform mat4 world;
uniform vec3 uRingN;
varying vec3 vObj;
// Свет считается в МИРОВЫХ координатах.
//
// Нормаль переводится в мир, солнце приходит извне одним общим для всех
// уникформом, и тень честно ползёт по глобусу, когда камера облетает карту.
// Масштаб планеты равномерный (baseRadius), поэтому mat3(world) для нормали
// достаточно — обратная транспонированная матрица не нужна.
varying vec3 vWorldN;
varying vec3 vWorldP;
varying vec3 vRingN;
void main(){
  vObj = position;
  vWorldN = normalize(mat3(world) * normal);
  vRingN = normalize(mat3(world) * uRingN);
  vWorldP = (world * vec4(position, 1.0)).xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uLand; uniform vec3 uSea; uniform vec3 uAtmo;
uniform vec3 uTint; uniform float uWater; uniform float uRough;
uniform float uClouds; uniform float uTime; uniform float uSeed;
uniform float uFreq; uniform float uWarp; uniform float uBands;
uniform float uCity; uniform float uCapSize; uniform float uContinent;
uniform float uRidges; uniform float uCraters;
uniform float uBattle; uniform float uDim; uniform float uScar;
uniform float uOct; uniform float uLava; uniform float uIce; uniform float uToxic;
uniform float uRadius;
uniform sampler2D uMask; uniform float uUseMask;
// Тень кольца: нормаль плоскости кольца в системе планеты и его радиусы.
uniform vec3 uRingN; uniform float uRingIn; uniform float uRingOut; uniform float uHasRing;
/** Направление НА солнце в мировых координатах — одно на всю карту. */
uniform vec3 uSun;
uniform vec3 cameraPosition;
varying vec3 vObj; varying vec3 vWorldN; varying vec3 vWorldP; varying vec3 vRingN;
${NOISE_GLSL}
void main(){
  vec3 n = normalize(vObj);
  vec3 sp = n * (uFreq + uRough) + vec3(uSeed);
  // Размер пикселя на поверхности сферы — мера того, какие частоты вообще
  // различимы отсюда. Ниже ею гасятся все мелкие узоры.
  float fw = fwidth(n.x) + fwidth(n.y) + fwidth(n.z);
  float scl = uFreq + uRough;
  // Предел различимости: последняя октава, чей период ещё шире пикселя.
  // log2(2.07) ≈ 1.05 — во столько раз растёт частота на каждой октаве.
  gOct = clamp(log2(0.60 / max(fw * scl, 1e-5)) / 1.05, 1.0, uOct);

  // Доменное искажение — континенты обретают естественные рваные очертания.
  vec3 w = vec3(fbm(sp + 13.1), fbm(sp + 71.7), fbm(sp + 29.3));
  vec3 q = sp + uWarp * w;
  // Крупная низкочастотная компонента сливает сушу в настоящие континенты.
  float h = mix(fbm(q), fbm(q * 0.42 + 5.7), uContinent);

  // Газовые гиганты: турбулентные широтные полосы.
  if (uBands > 0.5) {
    h = mix(h, sin(n.y * uBands + w.x * 4.0 + uSeed) * 0.55, 0.7);
  }

  float hn = h * 0.5 + 0.5;

  // Настоящая карта континентов (Супер-Земля): маска в эквидистантной проекции
  // задаёт сушу, fbm слегка рвёт береговую линию.
  if (uUseMask > 0.5) {
    float lon = atan(n.z, n.x) / 6.2831853 + 0.5;
    float latv = asin(clamp(n.y, -1.0, 1.0)) / 3.1415926 + 0.5;
    float m = texture2D(uMask, vec2(lon, latv)).r;
    float coast = fbm(q * 3.2) * 0.14;
    hn = mix(uWater - 0.22, uWater + 0.3, clamp(m + coast, 0.0, 1.0));
  }

  float land = smoothstep(uWater - 0.05, uWater + 0.05, hn);
  vec3 surf = mix(uSea, uLand, land);

  // Высотная окраска суши: низины темнее и сочнее, нагорья светлее.
  float relief = fbm(q * 2.6);
  surf = mix(surf * 0.8, surf * 1.25, smoothstep(-0.4, 0.6, relief) * land);

  // --- Настоящий рельеф вместо размытых пятен ------------------------------
  //
  // Три слоя разного масштаба, и каждый добавляет ту частоту, которой раньше
  // не было: складчатые горы с острым гребнем, эрозионная сетка долин и
  // мелкое зерно поверхности. Всё считается только на суше — на воде и в
  // облаках эти детали не нужны и стоили бы даром.
  float mountains = ridged(q * 1.9 + 4.3, min(gOct, 5.0));
  float chains = smoothstep(0.55, 0.95, mountains) * band(scl * 1.9, fw);
  surf = mix(surf, surf * 0.66, chains * 0.55 * land);
  float crest = smoothstep(0.86, 1.02, mountains) * band(scl * 1.9, fw);
  surf += vec3(0.13, 0.12, 0.11) * crest * land;

  // Эрозия: узкие тёмные жилы долин там, где склон круче всего.
  float valleys = 1.0 - abs(fbm(q * 4.1 + 51.0));
  surf = mix(surf, surf * 0.72,
    smoothstep(0.88, 1.0, valleys) * land * 0.7 * band(scl * 4.1, fw));

  // Зерно поверхности — то, что глаз читает как «резкость». Каждый слой
  // живёт ровно до своего предела различимости, иначе вместо резкости
  // получается муар.
  float detail = fbm(q * 5.3);
  surf *= 1.0 + (detail * 0.5 - 0.07) * 0.28 * band(scl * 5.3, fw);
  surf *= 1.0 + (grit(q * 15.0) - 0.5) * 0.22 * band(scl * 15.0, fw);
  surf *= 1.0 + (grit(q * 38.0 + 7.0) - 0.5) * 0.13 * band(scl * 38.0, fw);

  // --- Рельеф уходит в СВЕТ, а не только в цвет ------------------------------
  //
  // Всё, что посчитано выше, жило исключительно в цвете: горы, долины и зерно
  // рисовались светлее и темнее, но нормаль оставалась нормалью гладкого шара.
  // Свет ложился ровно по сфере, и поверхность читалась плоской картинкой,
  // натянутой на мяч, — именно это и выглядит «мылом», сколько октав ни
  // добавляй.
  //
  // Поле высот собирается из УЖЕ посчитанных слоёв, лишнего шума не считается:
  // поэтому свет ложится ровно по тому рисунку, который виден в цвете.
  // В высоту идут ТОЛЬКО крупные формы: хребты и долины. Мелкое зерно
  // (detail, grit) сюда попасть не должно — нормаль считается через
  // производную, а производная высокочастотного шума и есть высокочастотный
  // шум. С зерном в высоте планета покрывалась попиксельной «солью с перцем»
  // вместо рельефа: ровно тот муар, ради борьбы с которым и написан band().
  float hgt = (mountains * 0.62 - valleys * 0.22) * land;
  if (uRidges > 0.5) hgt += ridged(q * 1.15 + 31.0, min(gOct, 4.0)) * 0.45;

  // Прибрежная полоса чуть светлее (отмели).
  float shore = smoothstep(uWater - 0.05, uWater, hn) * (1.0 - land);
  surf += uSea * shore * 0.5;

  // Хребты: тёмные жилы горных цепей (пустыни и безводные миры).
  if (uRidges > 0.5) {
    // На безводных мирах горы — главный сюжет поверхности, поэтому вторая,
    // более крупная гряда поверх общей складчатости.
    float ridge = ridged(q * 1.15 + 31.0, min(gOct, 5.0));
    float big = smoothstep(0.50, 0.92, ridge) * band(scl * 1.15, fw);
    surf = mix(surf, surf * 0.45, big * 0.8);
    surf += vec3(0.16, 0.13, 0.09) * smoothstep(0.88, 1.05, ridge) * band(scl * 1.15, fw);
    // Дюнные поля между грядами: направленная рябь, а не изотропный шум.
    float dunes = sin(dot(n, vec3(0.7, 0.2, -0.68)) * 90.0 + fbm(q * 1.7) * 9.0);
    surf *= 1.0 + 0.055 * dunes * (1.0 - big) * band(90.0, fw);
  }

  // Ледяные миры: поля разломанных плит с подсвеченными кромками.
  if (uIce > 0.5) {
    float plate = 1.0 - abs(fbm(q * 3.3 + 77.0));
    float vis = band(scl * 3.3, fw);
    float crack = smoothstep(0.90, 0.995, plate) * vis;
    surf = mix(surf, surf * 0.68 + vec3(0.05, 0.09, 0.14), crack * 0.85);
    surf += vec3(0.10, 0.13, 0.16) * smoothstep(0.975, 1.0, plate) * vis;
  }

  // Кратерные поля мёртвых миров: чаши с подсвеченными валами.
  if (uCraters > 0.5) {
    float cr = abs(snoise(q * 3.1 + 60.0));
    float bowl = 1.0 - smoothstep(0.0, 0.09, cr);
    float rim = smoothstep(0.05, 0.09, cr) - smoothstep(0.09, 0.2, cr);
    surf = mix(surf, surf * 0.5, bowl * 0.85);
    surf += vec3(0.12, 0.11, 0.1) * rim;
  }

  // Полярные шапки — только там, где им положено быть (uCapSize > 1 = нет шапок).
  // Кромка льда рваная: шум ломает ровную границу.
  float lat = abs(n.y);
  float cap = smoothstep(uCapSize, uCapSize + 0.1, lat + relief * 0.05 + fbm(q * 3.1 + 9.0) * 0.045);
  surf = mix(surf, vec3(0.93, 0.96, 1.0), cap * 0.85);

  // Большой шторм-вихрь газового гиганта (у каждого — свой, по сиду).
  if (uBands > 0.5) {
    float lonS = atan(n.z, n.x);
    vec2 sd = vec2(sin(lonS - uSeed), (n.y - 0.22) * 2.6);
    float storm = 1.0 - smoothstep(0.1, 0.4, length(sd));
    float swirl = fbm(sp * 3.0 + vec3(uTime * 0.05, 0.0, 0.0)) * 0.5 + 0.5;
    surf = mix(surf, surf * 1.45 + uLand * 0.3, storm * (0.55 + 0.45 * swirl));
  }

  // Два слоя облаков: крупные массивы + перистая рябь.
  float c1 = fbm(sp * 1.6 + vec3(uTime * 0.03, 0.0, 0.0));
  float c2 = fbm(sp * 4.2 + vec3(-uTime * 0.05, uTime * 0.01, 0.0));
  float clouds = smoothstep(0.32, 0.72, c1 * 0.5 + 0.5) * 0.75 + smoothstep(0.55, 0.9, c2 * 0.5 + 0.5) * 0.35;
  clouds *= uClouds;
  // Токсичные миры: кислотно-зелёные вихри вместо белых облаков.
  vec3 cloudCol = mix(vec3(1.0), vec3(0.72, 1.0, 0.5), uToxic);
  surf = mix(surf, cloudCol, clamp(clouds, 0.0, 1.0) * 0.6);

  // --- Освещение ------------------------------------------------------------
  // Мир должен иметь ночную сторону.
  //
  // Свет по-прежнему заворачивается за терминатор (wrap-diffuse) — жёсткая
  // ламбертова граница выглядит дёшево, — но заворот СИЛЬНО уже прежнего, а
  // полусферный ambient приглушён: раньше вместе они держали теневую сторону
  // подсвеченной почти как дневную, и планета читалась плоским ярким кругом
  // без объёма.
  vec3 nrm = normalize(vWorldN);
  // Разворот нормали по градиенту высоты — приём Микельсена через экранные
  // производные: настоящей карты нормалей нет, а склоны всё равно начинают
  // ловить свет. Сила падает вместе с различимостью: на планете в десяток
  // пикселей бугры превратились бы в мерцающий шум, а не в рельеф.
  {
    vec3 dpx = dFdx(vWorldP);
    vec3 dpy = dFdy(vWorldP);
    float det = dot(dpx, cross(dpy, nrm));
    if (abs(det) > 1e-12) {
      vec3 grad = (cross(dpy, nrm) * dFdx(hgt) + cross(nrm, dpx) * dFdy(hgt)) / det;
      // Сила рельефа скромная и вдобавок гаснет по размеру пикселя дважды:
      // через band() и через прямой множитель. Разворот нормали — самый
      // заметный эффект в кадре, и передозировка здесь читается как брак.
      float bumpFade = band(scl * 1.9, fw) * (1.0 - smoothstep(0.004, 0.02, fw));
      nrm = normalize(nrm - grad * uRadius * 0.30 * bumpFade);
    }
  }
  vec3 sun = normalize(uSun);
  float ndl = dot(nrm, sun);
  const float WRAP = 0.12;
  float diff = clamp((ndl + WRAP) / (1.0 + WRAP), 0.0, 1.0);
  diff *= diff * (3.0 - 2.0 * diff);            // мягкое S-образное спадание

  // Ambient — только отсвет неба и диска, а не вторая лампа: тень должна
  // оставаться тенью, иначе объём теряется.
  vec3 skyAmb = vec3(0.058, 0.072, 0.100);       // холодное небо сверху
  vec3 gndAmb = vec3(0.044, 0.038, 0.034);       // тёплый отсвет снизу
  vec3 ambient = mix(gndAmb, skyAmb, nrm.y * 0.5 + 0.5);
  // Тень от колец: луч на солнце из точки поверхности пересекается с
  // плоскостью кольца; попадание между внутренним и внешним радиусом гасит
  // прямой свет. Полоса тени ползёт по глобусу вместе с наклоном кольца.
  float ringShadow = 1.0;
  if (uHasRing > 0.5) {
    // Нормаль кольца переведена в мир тем же преобразованием, что и nrm:
    // иначе полоса тени легла бы мимо освещённой стороны.
    vec3 rn = normalize(vRingN);
    float denom = dot(rn, sun);
    if (abs(denom) > 1e-4) {
      float t = -dot(rn, nrm) / denom;           // nrm на сфере = точка на ней
      if (t > 0.0) {
        vec3 hit = nrm + sun * t;
        float r = length(hit - rn * dot(rn, hit));
        float band = smoothstep(uRingIn, uRingIn + 0.06, r) *
                     (1.0 - smoothstep(uRingOut - 0.06, uRingOut, r));
        ringShadow = 1.0 - band * 0.62;
      }
    }
  }

  vec3 sunCol = vec3(1.0, 0.965, 0.90);
  vec3 col = surf * (ambient + sunCol * diff * 1.02 * ringShadow);

  // Тёплая полоса терминатора — «закат» на границе дня и ночи. Стала заметнее:
  // теперь ей есть на чём проступать.
  float term = smoothstep(0.0, 0.16, diff) * (1.0 - smoothstep(0.16, 0.42, diff));
  col += vec3(0.44, 0.22, 0.09) * term * 0.34 * (1.0 - clouds * 0.5);

  // Солнечный блик на воде: шире и слабее, чтобы не резал глаз.
  vec3 vd = normalize(cameraPosition - vWorldP);
  float spec = pow(clamp(dot(reflect(-sun, nrm), vd), 0.0, 1.0), 42.0);
  col += vec3(1.0, 0.97, 0.88) * spec * (1.0 - land) * (1.0 - clouds) * 0.26;

  // Ледяные миры: сеть трещин и холодный зеркальный блеск.
  if (uIce > 0.5) {
    float cracks = smoothstep(0.84, 0.96, 1.0 - abs(fbm(q * 5.5 + 23.0)));
    col = mix(col, vec3(0.6, 0.8, 1.0), cracks * 0.3 * band(scl * 5.5, fw));
    col += vec3(0.7, 0.85, 1.0) * spec * 0.4;
  }

  // Магмовые миры: лавовые океаны светятся и ночью, по коре бегут жилы огня.
  //
  // Яркость НЕ пульсирует целиком: общий множитель по времени заставлял
  // планету мигать как лампочка — особенно заметно, когда мир занимает на
  // экране десяток пикселей. Вместо этого по поверхности медленно течёт
  // тепловой шум, поэтому светятся то одни жилы, то другие.
  if (uLava > 0.5) {
    vec3 flow = q * 3.1 + vec3(uTime * 0.035, uTime * 0.021, uTime * 0.028);
    float heat = fbm(flow) * 0.5 + 0.5;
    col += uSea * (1.0 - land) * (0.42 + 0.16 * heat);
    float veins = smoothstep(0.78, 0.93, 1.0 - abs(fbm(q * 4.2 + 7.0)));
    col += vec3(1.0, 0.36, 0.06) * veins * land * (0.62 + 0.34 * heat) * band(scl * 4.2, fw);
  }

  // Ночные огни городов на тёмной стороне обитаемых миров.
  if (uCity > 0.5) {
    float night = 1.0 - smoothstep(0.0, 0.25, diff);
    float lights = smoothstep(0.72, 0.86, fbm(q * 7.0) * 0.5 + 0.5);
    col += vec3(1.0, 0.82, 0.45) * lights * night * land * (1.0 - clouds) * 0.9
      * mix(0.35, 1.0, band(scl * 7.0, fw));
  }

  // Погода войны: на сражающейся планете тлеют пожары и стелется гарь.
  if (uBattle > 0.5) {
    // Пожары движутся вместе с шумом, но не строботят: множитель на sin с
    // частотой в пять герц давал именно мигание, а не жизнь.
    float fire = smoothstep(0.74, 0.94, fbm(q * 6.0 + vec3(uTime * 0.25)) * 0.5 + 0.5);
    col += vec3(1.0, 0.42, 0.1) * fire * land * 0.85;
    float smoke = smoothstep(0.5, 0.85, fbm(q * 2.4 + vec3(-uTime * 0.06, uTime * 0.04, 0.0)) * 0.5 + 0.5);
    col = mix(col, vec3(0.16, 0.14, 0.13), smoke * 0.35);
  }
  // Шрамы войны: выжженные пятна на месте долгих сражений — навсегда.
  if (uScar > 0.5) {
    float burn = smoothstep(0.68, 0.9, fbm(q * 3.4 + 17.0) * 0.5 + 0.5);
    col = mix(col, vec3(0.07, 0.06, 0.05), burn * 0.55 * land);
    float ash = smoothstep(0.8, 0.95, fbm(q * 6.8 + 41.0) * 0.5 + 0.5);
    col = mix(col, vec3(0.2, 0.18, 0.16), ash * 0.3);
  }

  // Осада: отрезанный от снабжения мир меркнет.
  col *= uDim;

  // Фракционный ободок — единственная цветовая кодировка на сфере.
  // Показатель степени высокий намеренно: кайма должна быть узкой полоской
  // у самого края, а не широкой заливкой в полпланеты.
  float fres = pow(1.0 - clamp(dot(nrm, vd), 0.0, 1.0), 6.5);
  col += uTint * fres * 1.3;
  col += uAtmo * fres * 0.10;
  gl_FragColor = vec4(col, 1.0);
}
`;

const ATMO_VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 worldViewProjection;
uniform mat4 world;
varying vec3 vWorldN;
varying vec3 vWorldP;
void main(){
  vWorldN = normalize(mat3(world) * normal);
  vWorldP = (world * vec4(position, 1.0)).xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const ATMO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uSun;
uniform vec3 cameraPosition;
varying vec3 vWorldN; varying vec3 vWorldP;
void main(){
  vec3 nrm = normalize(vWorldN);
  vec3 vd = normalize(cameraPosition - vWorldP);
  // Атмосферная оболочка: тонкий нимб у самого лимба, без раздутого гало.
  float fres = pow(1.0 - clamp(dot(nrm, vd), 0.0, 1.0), 7.0);
  // Нимб СВЕТИТСЯ ТОЛЬКО СО СТОРОНЫ СОЛНЦА. Раньше он шёл ровным кольцом по
  // всему лимбу, включая ночную сторону, и это сильнее всего съедало объём:
  // как ни затемняй поверхность, планета оставалась ярким кругом в ободке.
  // Солнце то же, что в шейдере поверхности, — общий мировой уникформ.
  vec3 sun = normalize(uSun);
  float lit = smoothstep(-0.35, 0.30, dot(nrm, sun));
  // На ночной стороне остаётся едва заметный контур: мир не должен пропадать
  // с карты целиком.
  gl_FragColor = vec4(uColor, fres * (0.07 + 0.55 * lit));
}
`;

// Шум подставляется в тело фрагментника поверхности там же, где и раньше.
Effect.ShadersStore['planetSurfaceVertexShader'] = VERT;
Effect.ShadersStore['planetSurfaceFragmentShader'] = FRAG.replace('${NOISE_GLSL}', NOISE_GLSL);
Effect.ShadersStore['planetAtmoVertexShader'] = ATMO_VERT;
Effect.ShadersStore['planetAtmoFragmentShader'] = ATMO_FRAG;

/** Атрибуты и уникформы шейдера поверхности — контракт с ShaderMaterial. */
export const SURFACE_ATTRS = ['position', 'normal'];
export const SURFACE_UNIFORMS = [
  'worldViewProjection', 'world', 'cameraPosition',
  'uLand', 'uSea', 'uAtmo', 'uTint', 'uWater', 'uRough', 'uClouds', 'uTime',
  'uSeed', 'uFreq', 'uWarp', 'uBands', 'uCity', 'uCapSize', 'uContinent',
  'uRidges', 'uCraters', 'uBattle', 'uDim', 'uScar', 'uOct', 'uLava', 'uIce',
  'uToxic', 'uUseMask', 'uRingN', 'uRingIn', 'uRingOut', 'uHasRing', 'uSun', 'uRadius',
];
export const ATMO_UNIFORMS = ['worldViewProjection', 'world', 'cameraPosition', 'uColor', 'uSun'];
