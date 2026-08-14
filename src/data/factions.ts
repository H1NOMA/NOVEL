import type { FactionDef, FactionId, SpecialUnitDef } from '../core/types';

export const FACTIONS: Record<FactionId, FactionDef> = {
  superEarth: {
    id: 'superEarth',
    name: 'Супер-Земля',
    short: 'СЗ',
    color: '#3fa9f5',
    accent: '#ffe14d',
    blurb:
      'Колыбель человечества и сияющий маяк Управляемой Демократии. Сто лет мира куплены кровью Первой Галактической — и теперь каждый гражданин обязан её защитить. Флоты супер-эсминцев несут Свободу на ста тысячах орудийных стволов, а Хеллдайверы падают с орбиты туда, где Демократия нужнее всего. Свобода не даётся бесплатно.',
    capital: 'Супер-Земля',
    aggression: 1.0,
    specialName: 'Демократическая космическая станция (DSS)',
    specialBlurb:
      'Мобильная орбитальная крепость. Где она встаёт на якорь — орбитальные бомбардировки сокрушают гарнизоны врага и воодушевляют Хеллдайверов.',
    homeBiomes: ['terran', 'ocean', 'jungle'],
    playable: true,
  },
  automatons: {
    id: 'automatons',
    name: 'Автоматоны',
    short: 'АВТ',
    color: '#e0342b',
    accent: '#ff8a3d',
    blurb:
      'Наследники казнённых киборгов Киберстана. Холодный машинный разум не знает ни страха, ни усталости, ни пощады: каждый павший легион переплавляется в два новых, каждый захваченный мир становится литейной. Красные реки Малевелон-Крика помнят, что бывает с теми, кто недооценил марш стали.',
    capital: 'Киберстан',
    aggression: 1.15,
    specialName: 'Автоматонская космическая станция (ASS)',
    specialBlurb:
      'Боевая станция размером с луну, ощетинившаяся орудиями. Медленный и неумолимый двигатель завоевания, стирающий целые сектора.',
    homeBiomes: ['magma', 'volcanic', 'barren'],
    playable: true,
  },
  illuminate: {
    id: 'illuminate',
    name: 'Иллюминаты',
    short: 'ИЛЛ',
    color: '#8b5bd8',
    accent: '#c39bff',
    blurb:
      'Древняя раса, изгнанная за грань карты сто лет назад — и вернувшаяся из тьмы, где время течёт иначе. Их флоты выходят из складок пространства без предупреждения, их шёпот превращает граждан в Безголосых, а их экзошпили утягивают целые миры в Бездну. Они не мстят. Они собирают урожай.',
    capital: "Святилище Скв'бай",
    aggression: 1.1,
    specialName: 'Монолит Великого Воинства',
    specialBlurb:
      'Дрейфующий обелиск чужой технологии. Его фазовые поля скрывают флоты иллюминатов и расплетают реальность вокруг спорных миров.',
    homeBiomes: ['gas', 'ice', 'ocean'],
    playable: true,
  },
  terminids: {
    id: 'terminids',
    name: 'Терминиды',
    short: 'ТРМ',
    color: '#e8b830',
    accent: '#f6e27a',
    blurb:
      'Рой не строит империй — рой ЕСТЬ империя. Миллиарды хитиновых тел, единый голод и споровые тучи Мрака, в которых гаснут чужие флоты. Каждый павший мир становится гнездом, каждое гнездо — источником Элемента-710, за который человечество готово убивать. Рой это знает. И ждёт.',
    capital: 'Кеплер Прайм',
    aggression: 1.05,
    specialName: 'Суперколония терминидов',
    specialBlurb:
      'Живой мир-улей, извергающий бесконечные рои. Оставленный без присмотра, он расползается по линиям снабжения, как сам Мрак.',
    homeBiomes: ['gloom', 'desert', 'toxic'],
    playable: true,
  },
  superFederation: {
    id: 'superFederation',
    name: 'Супер-Федерация',
    short: 'ФЕД',
    color: '#ff8c1a',
    accent: '#ffd18a',
    blurb:
      'Рождена из краха Управляемой Демократии. Когда стабильность падает и пройден Путь к Федерации, разочарованные колонии отделяются — и направляют оружие против самой Супер-Земли.',
    capital: 'Новый Конкорд',
    aggression: 1.2,
    specialName: 'Дредноут Федерации',
    specialBlurb:
      'Бывшие линкоры Супер-Земли с экипажами из перебежчиков, знающих каждую тактику СЗ — и каждую её слабость.',
    homeBiomes: ['terran', 'desert', 'barren'],
    playable: false,
    hidden: true,
  },
};

export const FACTION_IDS: FactionId[] = [
  'superEarth',
  'automatons',
  'illuminate',
  'terminids',
];

/** Названия фракций в родительном падеже — для строк журнала событий. */
export const FACTION_GEN: Record<FactionId, string> = {
  superEarth: 'Супер-Земли',
  automatons: 'Автоматонов',
  illuminate: 'Иллюминатов',
  terminids: 'Терминидов',
  superFederation: 'Супер-Федерации',
};

export const SPECIALS: Record<FactionId, SpecialUnitDef> = {
  superEarth: {
    id: 'dss',
    faction: 'superEarth',
    name: 'Демократическая космическая станция (DSS)',
    blurb: FACTIONS.superEarth.specialBlurb,
    power: 2.4,
    auraRange: 1,
  },
  automatons: {
    id: 'starDestroyer',
    faction: 'automatons',
    name: 'Автоматонская космическая станция (ASS)',
    blurb: FACTIONS.automatons.specialBlurb,
    power: 2.8,
    auraRange: 1,
  },
  illuminate: {
    id: 'monolith',
    faction: 'illuminate',
    name: 'Монолит Великого Воинства',
    blurb: FACTIONS.illuminate.specialBlurb,
    power: 2.5,
    auraRange: 2,
  },
  terminids: {
    id: 'superColony',
    faction: 'terminids',
    name: 'Суперколония терминидов',
    blurb: FACTIONS.terminids.specialBlurb,
    power: 2.6,
    auraRange: 2,
  },
  superFederation: {
    id: 'dreadnought',
    faction: 'superFederation',
    name: 'Дредноут Федерации',
    blurb: FACTIONS.superFederation.specialBlurb,
    power: 2.7,
    auraRange: 1,
  },
};

/** Diplomatic matrix — true means the two factions are hostile. */
export function areHostile(a: FactionId, b: FactionId): boolean {
  if (a === b) return false;
  // Everyone is hostile to everyone in the Second Galactic War, except a
  // faction with itself. Super Federation fights Super Earth and all others.
  return true;
}

export function factionColor(id: FactionId): string {
  return FACTIONS[id].color;
}
