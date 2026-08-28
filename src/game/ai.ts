import type { FactionId, Fleet, Planet } from '../core/types';
import { FACTIONS } from '../data/factions';
import { fleetCap, isHuman, fleetsOf, modActive, planetsOf, pushChronicle, pushLog, spawnFleet, type GameState } from './state';
import { lockedInBattle, orderFleetTo } from './units';
import { buildDepot, canEnter, DEPOT_COST } from './supply';
import { buildShipyard, liftCapacity, SHIPYARD_COST } from './shipyards';
import { buildShield, buildStation, SHIELD_COST, STATION_COST } from './defense';
import { hostileNow } from './diplomacy';
import { orbitCovered, SE_MASS_TROOPS } from './combat';
import { drawUnits, mineE711, mineMinerals, replenishUnits, totalUnits } from './troops';
import { TRANSPORT_LIFT } from '../data/troops';
import { accruePower } from './politics';
import { warpFleet, WARP_COST } from './illuminate';
import { openPartition } from './partition';
import { bus } from '../core/emitter';

const FLEET_COST = 45;
const INFANTRY_CAP = 45;
/** Цена одной достроенной аппарели: вдвое дешевле пары с верфи, но и штука одна. */
const TRANSPORT_COST = 16;

/** Daily economy for every faction: production, manpower, fleet building, reload. */
export function runEconomy(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  if (!fs.alive) return;
  const worlds = planetsOf(state, faction);
  if (worlds.length === 0) {
    // Проект «Ковчег»: разбитые автоматоны с чертежами не гибнут — их разум
    // уходит во тьму за край карты и достраивает корабль-исход.
    if (faction === 'automatons' && fs.flags.arkPrepared && !fs.flags.arkDone) {
      if (!fs.flags.arkGhost) {
        fs.flags.arkGhost = true;
        const by = state.lastConqueror[faction] ?? null;
        for (const f of fleetsOf(state, faction)) f.order = { kind: 'idle' };
        if (faction === state.player) state.playerDefeated = true;
        pushLog(state, {
          faction,
          text: 'Супер-Земля победила автоматонов… но сигнал РАЗУМ-9 ещё звучит из тьмы. Доступен фокус «ПРОЕКТ „КОВЧЕГ“».',
          tone: faction === state.player ? 'alert' : 'good',
        });
        bus.emit('factionDefeated', { faction, by });
      }
      return;
    }
    // runEconomy is only invoked for active factions, so the Super Federation
    // reaches this path only after it has actually risen.
    eliminate(state, faction);
    return;
  }

  const income = worlds.reduce((s, p) => s + p.value, 0);
  // Стабильность Супер-Земли реально двигает промышленность: 0% → ×0.75,
  // 100% → ×1.25. Плюс условие кампании «Холодные кузницы».
  let prodMult = 1;
  if (faction === 'superEarth') prodMult *= 0.75 + fs.stability / 200;
  if (modActive(state, 'coldForges')) prodMult *= 0.85;
  fs.production += 0.4 * (fs.industry + income * 0.3) * prodMult;
  accruePower(state, faction);

  // Добыча ископаемых, пополнение пулов войск, добыча Е-711.
  mineMinerals(state, faction);
  replenishUnits(state, faction);
  if (faction === 'superEarth') mineE711(state);

  // Содержание флота: каждый корпус ежедневно ест производство.
  // Условие кампании «Дефицит корпусов» делает флот дороже.
  const upkeepRate = modActive(state, 'scrapShortage') ? 0.07 : 0.05;
  const upkeep = fleetsOf(state, faction)
    .reduce((s, f) => s + f.ships + f.dreadnoughts * 2 + f.battleships * 4, 0) * upkeepRate;
  fs.production = Math.max(0, fs.production - upkeep);

  // Build a new fleet when affordable and under the cap.
  // Игрок строит корабли сам — на верфях; автосборка флотов только у ИИ.
  const fleets = fleetsOf(state, faction);
  if (!isHuman(state, faction) && fs.production >= FLEET_COST && fleets.length < fleetCap(state, faction) && totalUnits(fs) >= 20) {
    fs.production -= FLEET_COST;
    const crew = drawUnits(fs, 20);
    const yard = worlds.find((p) => p.isCapital) ?? worlds[0]!;
    // Соединение Супер-Земли комплектуется транспортами под весь свой десант:
    // без аппарелей ВССЗ на планету не сойдут (см. liftCapacity).
    const transports = faction === 'superEarth' ? Math.ceil(crew / TRANSPORT_LIFT) : 0;
    spawnFleet(state, faction, yard.id, { ships: 6, infantry: crew, transports });
  }

  // Флоты на своих планетах докомплектовывают пехоту из пулов.
  // Потолок десанта растёт с годами войны — иначе фронты застывают:
  // гарнизоны отъедаются быстрее, чем 45 пехоты способны их прогрызть.
  const infantryCap = INFANTRY_CAP + Math.floor(state.day / 365) * 6;
  for (const f of fleets) {
    if (f.transit) continue;
    const p = state.galaxy.planets.get(f.at);
    // --- Аппарели растут вместе с потолком десанта ---------------------------
    //
    // Потолок пехоты поднимается с каждым годом войны, а транспорты ВССЗ
    // выдавались один раз при сборке соединения и больше не докупались. Через
    // десять лет у Супер-Земли на борту 24 места под 105 бойцов: остальные
    // ехали пассажирами, в бой не шли, и наступать гегемону было нечем. В
    // прогоне на десять сидов Супер-Земля гибла во всех десяти партиях.
    //
    // Флот на своей верфи достраивает аппарели под нынешний потолок и
    // поднимает штат — иначе пополнение из резерва тут же вернёт старое число.
    if (faction === 'superEarth' && p && p.owner === faction && !f.special) {
      const lift = liftCapacity(f);
      if (lift < infantryCap && fs.production >= TRANSPORT_COST) {
        fs.production -= TRANSPORT_COST;
        f.transports = (f.transports ?? 0) + 1;
        if (f.establishment) f.establishment.transports = Math.round(f.transports);
      }
    }
    if (p && p.owner === faction && f.infantry < infantryCap) {
      // Потолок погрузки — по транспортам: лишний батальон некуда сажать.
      const room = Math.min(infantryCap, liftCapacity(f)) - f.infantry;
      if (room <= 0) continue;
      const load = drawUnits(fs, Math.min(4, room));
      f.infantry += load;
    }
  }
  fs.manpower = totalUnits(fs);
}

function eliminate(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  if (!fs.alive) return;
  fs.alive = false;
  fs.activeFocus = undefined;
  for (const f of fleetsOf(state, faction)) f.order = { kind: 'idle' };
  const by = state.lastConqueror[faction] ?? null;
  pushChronicle(state, `Фракция «${FACTIONS[faction].name}» повержена и изгнана из галактики.`);
  pushLog(state, {
    faction,
    text: `Фракция «${FACTIONS[faction].name}» повержена и изгнана из галактики!`,
    tone: faction === state.player ? 'bad' : 'good',
  });
  if (faction === state.player) state.playerDefeated = true;
  bus.emit('factionDefeated', { faction, by });
  // Если у изгнанной фракции ещё остались миры, они тоже делятся по очкам.
  openPartition(state, faction, by);
}

/**
 * Стратегическое планирование: у каждой фракции — кампания с приоритетной
 * целью, а не «хватать всё подряд». План пересматривается раз в 12 дней.
 *  • Автоматоны с чертежами супероружия рвутся к магмовым мирам с богатыми
 *    залежами — там встанет особая верфь и сервисный док ССА.
 *  • Иллюминаты охотятся на населённые миры Супер-Земли — урожай для масс.
 *  • Терминиды дозахватывают сектора роя целиком (Мрак требует полных секторов).
 *  • Остальные (и все по умолчанию) методично закрывают начатые сектора.
 *  • Столица в осаде перекрывает всё — план «оборона».
 */
export function updatePlan(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  const worlds = planetsOf(state, faction);

  // Оборона столицы важнее любых амбиций.
  const capital = worlds.find((p) => p.isCapital);
  if (capital?.battle && capital.battle.liberation > 15) {
    fs.aiPlan = { goal: 'defense', target: capital.id, note: `оборона столицы ${capital.name}` };
    return;
  }

  // Автоматоны: проект супероружия требует платиновых руд магмовых миров.
  if (faction === 'automatons' && fs.specialUnlocked) {
    const hasDock = worlds.some((p) => p.buildings.includes('specialDock'));
    if (!hasDock) {
      const site = state.galaxy.order
        .map((id) => state.galaxy.planets.get(id)!)
        .filter((p) => p.biome === 'magma' && p.minerals >= 2 && !p.shattered && !p.abyss)
        .sort((a, b) => {
          const da = a.owner === faction ? -1 : nearestDist(worlds, a);
          const db = b.owner === faction ? -1 : nearestDist(worlds, b);
          return da - db;
        })[0];
      if (site) {
        fs.aiPlan = { goal: 'superweaponSite', target: site.id, note: `плацдарм супероружия: ${site.name}` };
        return;
      }
    }
  }

  // Иллюминаты: урожай с миров Супер-Земли.
  if (faction === 'illuminate') {
    const prey = state.galaxy.order
      .map((id) => state.galaxy.planets.get(id)!)
      .filter((p) => p.owner === 'superEarth' && !p.shattered &&
        p.links.some((l) => state.galaxy.planets.get(l)!.owner === faction))
      .sort((a, b) => b.cities.length - a.cities.length)[0];
    if (prey) {
      fs.aiPlan = { goal: 'harvest', target: prey.id, note: `сбор урожая: ${prey.name}` };
      return;
    }
  }

  // По умолчанию: закрыть сектор, где у фракции больше всего миров, но не все.
  let best: { target: string; own: number } | null = null;
  for (const sector of state.galaxy.sectors.values()) {
    const ps = sector.planets.map((id) => state.galaxy.planets.get(id)!).filter((p) => !p.shattered && !p.abyss);
    const own = ps.filter((p) => p.owner === faction).length;
    const missing = ps.filter((p) => p.owner !== faction && hostileNow(state, faction, p.owner));
    if (own > 0 && missing.length > 0 && (!best || own > best.own)) {
      const t = missing.sort((a, b) => a.garrison - b.garrison)[0]!;
      best = { target: t.id, own };
    }
  }
  if (best) {
    const goal = faction === 'terminids' ? 'swarmSector' : 'consolidate';
    const t = state.galaxy.planets.get(best.target)!;
    fs.aiPlan = { goal, target: best.target, note: `зачистка сектора ${t.sector}` };
  } else {
    // Нет недобитых секторов — курс на Супер-Землю: ближайший к центру
    // фронтирный вражеский мир становится целью кампании.
    const push = state.galaxy.order
      .map((id) => state.galaxy.planets.get(id)!)
      .filter((p) => hostileNow(state, faction, p.owner) && !p.shattered && !p.abyss &&
        p.links.some((l) => state.galaxy.planets.get(l)!.owner === faction))
      .sort((a, b) => a.radius - b.radius)[0];
    if (push) {
      fs.aiPlan = { goal: 'consolidate', target: push.id, note: `наступление к центру: ${push.name}` };
    } else {
      fs.aiPlan = { goal: 'consolidate', target: null, note: 'экспансия' };
    }
  }
}

function nearestDist(worlds: Planet[], p: Planet): number {
  let d = Infinity;
  for (const w of worlds) d = Math.min(d, Math.hypot(w.pos.x - p.pos.x, w.pos.y - p.pos.y));
  return d;
}

/**
 * Тактический ИИ флотов. Принципы:
 *  • цели оцениваются (слабый гарнизон, окружение, ценность, столицы),
 *    а не берётся просто ближайшая;
 *  • без достаточного перевеса сил ИИ копит войска, а не бросается в бой;
 *  • при угрозе своим мирам флоты отзываются на оборону;
 *  • потрёпанные соединения отходят в тыл на переформирование;
 *  • НАСТУПЛЕНИЕ ИДЁТ НЕСКОЛЬКИМИ ОСЯМИ. Раньше все соединения фракции
 *    считали лучшую цель по одной и той же формуле и, разумеется, находили
 *    одну и ту же: весь флот собирался над единственной планетой, остальной
 *    фронт стоял. Теперь занятые цели помечаются, и на одну планету идёт не
 *    больше того, что нужно для её взятия, — следующее соединение ищет
 *    следующую ось. Оборона считается так же: два флота на один горящий мир
 *    не отправляются.
 */
export function runAI(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  if (!fs.alive) return;
  // Пересмотр стратегического плана раз в 12 дней.
  if (!fs.aiPlan || state.day % 12 === 0) {
    updatePlan(state, faction);
  }

  // Сколько десанта уже нацелено на каждую планету — свои же соединения,
  // летящие или штурмующие. Это и есть учёт осей наступления.
  const committed = new Map<string, number>();
  const commit = (target: string, troops: number) =>
    committed.set(target, (committed.get(target) ?? 0) + troops);
  for (const f of fleetsOf(state, faction)) {
    const dest = f.transit ? f.transit.to : f.at;
    const here = state.galaxy.planets.get(dest);
    if (!here) continue;
    if (here.owner !== faction || (here.battle && here.battle.defender === faction)) {
      commit(dest, f.infantry);
    }
  }

  for (const f of fleetsOf(state, faction)) {
    if (f.transit) continue;
    const here = state.galaxy.planets.get(f.at);
    if (!here) continue;

    const hulls = f.ships + f.dreadnoughts + f.battleships;

    // Потрёпан или пуст — отход на переформирование.
    //
    // Только С ЧУЖОЙ орбиты. Раньше условие срабатывало и в тылу, а поиск
    // убежища никогда не возвращал текущую планету, — потрёпанное соединение
    // каждый день получало приказ уйти на соседний свой мир, оттуда обратно, и
    // так до конца партии, занимая слот флота и ничего не делая.
    if (here.owner !== faction && (f.infantry < 6 || hulls < 2.5)) {
      const refuge = nearestOwnedWorld(state, faction, f.at);
      // Приказ может не пройти (скован боем, нет маршрута по своей земле) —
      // тогда соединение просто остаётся на месте, а не «числится отходящим».
      if (refuge) orderFleetTo(state, f, refuge, false);
      continue;
    }
    // В тылу потрёпанному соединению отходить некуда: оно уже дома и здесь же
    // пополняется (см. runEconomy).
    if (hulls < 2.5) continue;
    // Уже штурмует вражеский мир — держит хватку.
    if (here.owner !== faction && hostileNow(state, faction, here.owner)) continue;

    // Оборона прежде всего: если наш мир под серьёзным ударом — на выручку.
    // Но только если там ещё не хватает своих: спасать втроём один мир, пока
    // горят три, — ровно та ошибка, из-за которой ИИ сбивался в кучу.
    const threat = mostThreatenedWorld(state, faction, committed);
    if (threat) {
      const tp = state.galaxy.planets.get(threat)!;
      // Десант записывается в «занятые» ТОЛЬКО если приказ принят. Раньше
      // commit шёл безусловно: скованное боем соединение никуда не уходило, но
      // числилось идущим на выручку, и остальные считали мир уже прикрытым.
      if (tp.battle && tp.battle.liberation > 25 && threat !== f.at
          && orderFleetTo(state, f, threat, false)) {
        commit(threat, f.infantry);
        continue;
      }
    }

    // Наступление: лучшая цель в радиусе досягаемости.
    // Рой не копит резервы поколениями — бросается в атаку раньше прочих.
    const minInfantry = faction === 'terminids' ? 7 : 12;
    if (f.infantry >= minInfantry) {
      const target = bestInvasionTarget(state, faction, f, committed);
      if (target && orderFleetTo(state, f, target, true)) {
        commit(target, f.infantry);
        continue;
      }
    }
    // Сил маловато — копим на месте (докомплектация идёт в runEconomy),
    // а тем временем прикрываем самый ценный фронтовой мир.
    if (threat && threat !== f.at && orderFleetTo(state, f, threat, false)) {
      commit(threat, f.infantry);
    }
  }
}

/**
 * Бездна в руках ИИ.
 *
 * Варп — главное преимущество иллюминатов, и без этой процедуры оно
 * досталось бы только живому игроку: машинный разум водил бы флоты по линиям
 * снабжения, как все прочие, и способность существовала бы на бумаге.
 *
 * Логика намеренно скупая: прыгают, только когда набралось вдвое больше
 * власти, чем стоит прыжок (иначе казна уходит в никуда), и только СВОБОДНЫМ
 * соединением с настоящим десантом. Цель — жирный мир Супер-Земли без флота
 * на орбите: именно за такими и ныряют в Бездну, а не за ближайшим окопом.
 */
export function aiWarp(state: GameState, faction: FactionId): void {
  if (faction !== 'illuminate') return;
  const fs = state.factions[faction];
  if (!fs.alive || fs.politicalPower < WARP_COST * 2) return;

  // Праздных соединений у ИИ не бывает — они всегда куда-то идут, поэтому
  // ждать «свободного» флота бессмысленно: подойдёт любой с настоящим
  // десантом, хоть на полпути. Нельзя только выдёргивать скованных боем.
  const raider = fleetsOf(state, faction)
    .filter((f) => f.infantry >= 20 && !lockedInBattle(state, f))
    .sort((a, b) => b.infantry - a.infantry)[0];
  if (!raider) return;

  const prey = planetsOf(state, 'superEarth')
    .filter((p) => !p.shattered && hostileNow(state, faction, p.owner) &&
      canEnter(state, faction, p) && !orbitCovered(state, p))
    // Чем больше городов и ценности — тем богаче будущая точка людского
    // ресурса; слабый гарнизон означает, что мир возьмут, а не увязнут.
    .sort((a, b) => (b.cities.length * 3 + b.value - b.garrison * 0.15)
      - (a.cities.length * 3 + a.value - a.garrison * 0.15))[0];
  if (!prey) return;
  // Прыгать к соседу незачем — туда дойдут и так. Для летящего соединения
  // соседство считается от точки назначения, а не от места вылета.
  const whereFrom = raider.transit ? raider.transit.to : raider.at;
  if (whereFrom === prey.id) return;
  if (state.galaxy.planets.get(whereFrom)?.links.includes(prey.id)) return;
  warpFleet(state, faction, raider.id, prey.id);
}

/**
 * Стройка ИИ: не «щит на самый ценный мир», а разумная очередь по ролям.
 *
 * Мир получает сооружение по тому, чем он является для фракции:
 *   • столица и фронтовые ценные миры — щит и станция;
 *   • тыловые промышленные — верфь, чтобы флот вообще было где строить;
 *   • узлы на стыке своих секторов — точка снабжения (она ускоряет
 *     пополнение гарнизонов вокруг, а не только у себя).
 * Стройка теперь занимает дни, поэтому ИИ проверяет, что площадка свободна,
 * и НЕ пытается заложить второй объект на том же мире.
 */
export function aiBuild(state: GameState, faction: FactionId): void {
  const fs = state.factions[faction];
  if (!fs.alive) return;
  const worlds = planetsOf(state, faction)
    .filter((p) => p.supplied && !p.shattered && !p.build);
  if (!worlds.length) return;

  const frontier = (p: Planet) =>
    p.links.some((lid) => {
      const n = state.galaxy.planets.get(lid);
      return !!n && n.owner !== faction && hostileNow(state, faction, n.owner);
    });

  // Считаем ВСЁ, что есть и что уже строится, по всей территории — иначе ИИ
  // закладывает пятый щит подряд, потому что каждый следующий вызов видит
  // очередной непокрытый фронтовой мир и не помнит про четыре предыдущих.
  const all = planetsOf(state, faction);
  const owned = (kind: string): number => all.filter((p) =>
    p.build?.id === kind || (kind === 'shipyard' ? !!p.shipyard : kind === 'depot' ? p.depot : p.buildings.includes(kind))).length;

  const front = all.filter(frontier).length;
  // Сколько чего фракции вообще нужно при её нынешних размерах.
  //
  // Потолки РАСТУТ С ТЕРРИТОРИЕЙ, и это не мелочь. Прежние жёсткие «не больше
  // трёх станций» имели смысл для фракции из пяти миров, но Супер-Земля с её
  // двумя сотнями планет упиралась в тот же потолок: к первому году у неё
  // копилось двадцать тысяч производства, которые некуда было деть, а миры
  // при этом стояли без орбитального прикрытия. Гегемон обязан обстраиваться
  // соразмерно себе — иначе он платит за размер, ничего не получая взамен.
  const want: Record<string, number> = {
    shipyard: Math.min(14, 1 + Math.floor(all.length / 9)),
    shieldGen: Math.min(45, Math.ceil(front * 0.8)),
    orbStation: Math.min(50, 1 + Math.floor(all.length / 5)),
    depot: Math.min(26, Math.floor(all.length / 5)),
  };
  const cost: Record<string, number> = {
    shipyard: SHIPYARD_COST, shieldGen: SHIELD_COST, orbStation: STATION_COST, depot: DEPOT_COST,
  };

  // Строим то, чего не хватает СИЛЬНЕЕ ВСЕГО, а не то, что стоит первым в
  // списке приоритетов: так фракция развивается вширь, а не заваливает фронт
  // одними щитами.
  const gaps = Object.keys(want)
    .map((kind) => ({ kind, gap: want[kind]! - owned(kind) }))
    .filter((g) => g.gap > 0 && fs.production >= cost[g.kind]! + 60)
    .sort((a, b) => b.gap - a.gap);

  for (const { kind } of gaps) {
    // Верфь ставится в ТЫЛУ: фронтовую снесут вместе с планетой при первом же
    // захвате, а вместе с ней — весь склад корпусов.
    if (kind === 'shipyard') {
      const site = worlds.filter((p) => !p.shipyard && !frontier(p))
        .sort((a, b) => (b.isCapital ? 60 : b.value) - (a.isCapital ? 60 : a.value))[0];
      if (site && buildShipyard(state, faction, site.id)) return;
      continue;
    }
    // Щит — туда, где уже дерутся или вот-вот начнут.
    if (kind === 'shieldGen') {
      const hot = worlds.filter((p) => frontier(p) && !p.buildings.includes('shieldGen'))
        .sort((a, b) => ((b.battle ? 40 : 0) + b.value) - ((a.battle ? 40 : 0) + a.value))[0];
      if (hot && buildShield(state, faction, hot.id)) return;
      continue;
    }
    // Станция — на столицу и на ценные узлы: она бьёт и по пустой орбите.
    if (kind === 'orbStation') {
      const site = worlds.filter((p) => !p.buildings.includes('orbStation'))
        .sort((a, b) => ((b.isCapital ? 80 : 0) + b.value) - ((a.isCapital ? 80 : 0) + a.value))[0];
      if (site && buildStation(state, faction, site.id)) return;
      continue;
    }
    // Точка снабжения — в глубине, где больше всего своих соседей: такой узел
    // кормит пополнением целую гроздь миров, а не только себя.
    const hub = worlds.filter((p) => !p.depot)
      .map((p) => ({ p, n: p.links.filter((lid) => state.galaxy.planets.get(lid)?.owner === faction).length }))
      .sort((a, b) => b.n - a.n)[0];
    if (hub && hub.n >= 2 && buildDepot(state, faction, hub.p.id)) return;
  }
}

/**
 * Оценка целей вторжения: перевес сил обязателен, окружённые и слабо
 * защищённые миры ценятся выше, столицы — лакомая добыча, а главный вес
 * получает цель ТЕКУЩЕГО СТРАТЕГИЧЕСКОГО ПЛАНА и её сектор.
 */
function bestInvasionTarget(
  state: GameState,
  faction: FactionId,
  f: Fleet,
  committed: Map<string, number>,
): string | null {
  const fs = state.factions[faction];
  const myPower = f.infantry * (1 + fs.bonuses.combat);
  // Супер-Земля воюет кулаком, остальные — фронтом. Разница видна ниже.
  const fist = faction === 'superEarth';
  const plan = fs.aiPlan;
  const planSector = plan?.target ? state.galaxy.planets.get(plan.target)?.sector : undefined;
  // Гегемон: фракция, держащая больше 38% живых планет галактики.
  const totals = new Map<FactionId, number>();
  let living = 0;
  for (const pid of state.galaxy.order) {
    const pl = state.galaxy.planets.get(pid)!;
    if (pl.shattered || pl.abyss) continue;
    living++;
    totals.set(pl.owner, (totals.get(pl.owner) ?? 0) + 1);
  }
  let leader: FactionId | null = null;
  let leaderShare = 0;
  for (const [f2, n] of totals) {
    const share = n / Math.max(1, living);
    if (f2 !== faction && share > 0.33) { leader = f2; leaderShare = share; }
  }
  let best: string | null = null;
  let bestScore = 0;

  // Решимость затяжной войны: после третьего года требования к перевесу
  // постепенно снижаются — иначе фронты застывают навсегда (гарнизоны
  // отрастают быстрее, чем ИИ копит десант; ловили в балансовых прогонах).
  const desperation = Math.max(0.4, 1 - Math.max(0, state.day - 1100) / 3500);

  // Кандидаты: вражеские миры, смежные с нашей территорией (фронтир).
  for (const id of state.galaxy.order) {
    const p = state.galaxy.planets.get(id)!;
    if (p.owner === faction || p.shattered) continue;
    if (!hostileNow(state, faction, p.owner) || !canEnter(state, faction, p)) continue;
    const onFrontier = p.links.some((lid) => {
      const n = state.galaxy.planets.get(lid)!;
      return n.owner === faction && !n.shattered;
    });
    if (!onFrontier) continue;

    const defence = p.garrison * (1 + p.fortification * 0.12) * (p.supplied ? 1 : 0.55);
    const already = committed.get(id) ?? 0;
    // Ось наступления уже насыщена: над этой планетой достаточно своих сил,
    // и лишнее соединение здесь — не удар, а толчея. Пусть ищет другую цель.
    const saturated = fist
      ? already >= SE_MASS_TROOPS * 1.6
      : already > defence * 1.6;
    if (saturated) continue;
    // Без перевеса ИИ не лезет — копит силы (рой безрассуднее прочих).
    if (myPower + already < defence * (faction === 'terminids' ? 0.45 : 0.66) * desperation) continue;

    let score = myPower / (defence + 10);
    if (fist) {
      // Доктрина гегемона — КУЛАК. Супер-Земля не размазывает силы по фронту:
      // пока на оси нет полноценной группировки, следующее соединение идёт
      // туда же. Иначе она платит за рассредоточенность (оголённые тылы,
      // тонкие гарнизоны), но никогда не получает того, ради чего платит.
      if (already > 0 && already < SE_MASS_TROOPS) score += 5;
    } else if (already > 0) {
      // Уже начатую соседями операцию поддержать полезно, но чем плотнее там
      // свои, тем меньше смысла добавлять ещё: убывающая отдача от кучи.
      score -= (already / (defence + 10)) * 1.5;
    }
    score += p.value * 0.35;
    // Все фракции рвутся к Супер-Земле и центру галактики — важные точки.
    score += (1 - p.radius / state.galaxy.radiusMax) * 2.5;
    if (p.id === 'p_super_earth') score += 6;
    // Коалиция против гегемона: лидера по планетам бьют в первую очередь;
    // хозяина половины галактики — всей мощью.
    if (leader && p.owner === leader) score += leaderShare > 0.45 ? 6 : 3.5;
    if (!p.supplied) score += 3.5;          // окружённые — добить
    if (p.isCapital) score += 3;            // обезглавить врага
    if (p.battle && p.battle.attacker === faction) score += 2.5; // дожать штурм
    if (p.cities.length) score += p.cities.length * 0.5;

    // Дисциплина кампании: цель плана — в приоритете, её сектор — тоже;
    // миры в секторах, где у нас ни одной планеты, — распыление сил.
    if (plan?.target === id) score += 8;
    if (planSector && p.sector === planSector) score += 2;
    const sec = [...state.galaxy.sectors.values()].find((sc) => sc.planets.includes(id));
    if (sec && !sec.planets.some((pid) => state.galaxy.planets.get(pid)!.owner === faction)) {
      score -= 2.5;
    }
    // Марионетки без гарнизона — лёгкая, но второстепенная добыча.
    if (p.puppetOf) score -= 1;

    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

// --- BFS helpers over supply lines -----------------------------------------

function bfsFind(state: GameState, start: string, transit: (p: Planet) => boolean, goal: (p: Planet) => boolean): string | null {
  const seen = new Set<string>([start]);
  const q: string[] = [start];
  while (q.length) {
    const cur = q.shift()!;
    for (const n of state.galaxy.planets.get(cur)!.links) {
      if (seen.has(n)) continue;
      seen.add(n);
      const np = state.galaxy.planets.get(n)!;
      if (goal(np)) return n;
      if (transit(np)) q.push(n);
    }
  }
  return null;
}

function nearestOwnedWorld(state: GameState, faction: FactionId, from: string): string | null {
  return bfsFind(state, from, (p) => canEnter(state, faction, p), (p) => p.owner === faction);
}

/**
 * Самый угрожаемый свой мир — с поправкой на уже направленную туда помощь.
 * Без этой поправки все свободные соединения фракции летели спасать одну и ту
 * же планету, а соседние горящие миры оставались без единого корабля.
 */
function mostThreatenedWorld(
  state: GameState,
  faction: FactionId,
  committed: Map<string, number>,
): string | null {
  let best: Planet | null = null;
  let bestScore = 0;
  for (const p of planetsOf(state, faction)) {
    const help = committed.get(p.id) ?? 0;
    const score = (p.battle ? p.battle.liberation : 0) + (p.isCapital ? 20 : 0) - help * 0.6;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best?.id ?? null;
}
