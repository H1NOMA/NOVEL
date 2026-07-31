// Генерация названий планет и секторов в духе Helldivers.

const PREFIX = [
  'Малевелон', 'Драупнир', 'Эстану', 'Фенрир', 'Хеллмайр', 'Вернен', 'Ангел',
  'Убанея', 'Чухе', 'Пента', 'Меридия', 'Тьен', 'Эрата', 'Морт', 'Вандалон',
  'Ошон', 'Кельвин', 'Видоу', 'Тьюринг', 'Марфарк', 'Васат', 'Беквам', 'Дума',
  'Ахернар', 'Бор', 'Харон', 'Кримсика', 'Гакрукс', 'Хит',
  'Ингмар', 'Харст', 'Лесат', 'Мантес', 'Нублария', 'Омикрон', 'Пандион',
  'Скат', 'Труст', 'Устоту', 'Вейл', 'Зосма', 'Акамар', 'Борея', 'Денеб',
];

const SUFFIX = [
  'Прайм', 'Крик', 'Секундус', 'III', 'IX', 'Предел', 'Станция', 'Пояс',
  'Простор', 'Разлом', 'Рубеж', 'Глубь', 'Врата', 'Колыбель', 'Надир', 'Зенит',
  'Форпост', 'Лощина', 'Редут', 'Марш', 'Поля', 'Провал', 'Оплот',
];

const SECTOR_NAMES = [
  'Северин', 'Идун', 'Умлаут', 'Андромеда', 'Фальстаф', 'Готмар', 'Цзинь-Си',
  'Корпус', 'Лакайль', 'Мирин', 'Орион', 'Квинтус', 'Риктус', 'Саган',
  'Талус', 'Урса', 'Вальдис', 'Ксар', 'Имир', 'Зурга', 'Барнард', 'Кантолус',
];

export function planetName(rng: { int(a: number, b: number): number; pick<T>(a: readonly T[]): T; chance(p: number): boolean }, used: Set<string>): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    const p = rng.pick(PREFIX);
    const name = rng.chance(0.55) ? `${p} ${rng.pick(SUFFIX)}` : p;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `${rng.pick(PREFIX)}-${rng.int(1, 999)}`;
  used.add(fallback);
  return fallback;
}

const usedSectors = new Set<string>();

export function sectorName(rng: { pick<T>(a: readonly T[]): T; int(a: number, b: number): number }): string {
  for (let attempt = 0; attempt < 30; attempt++) {
    const n = `Сектор ${rng.pick(SECTOR_NAMES)}`;
    if (!usedSectors.has(n)) {
      usedSectors.add(n);
      return n;
    }
  }
  return `Сектор ${rng.pick(SECTOR_NAMES)}-${rng.int(2, 99)}`;
}
