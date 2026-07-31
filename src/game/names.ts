// Lore-flavoured planet name generation for the galaxy map.

const PREFIX = [
  'Malevelon', 'Draupnir', 'Estanu', 'Fenrir', 'Hellmire', 'Vernen', 'Angel',
  'Ubanea', 'Choohe', 'Penta', 'Meridia', 'Tien', 'Erata', 'Mort', 'Vandalon',
  'Oshaune', 'Kelvin', 'Widow', 'Turing', 'Marfark', 'Wasat', 'Bekvam', 'Duma',
  'Achernar', 'Bore', 'Charon', 'Crimsica', 'Gacrux', 'Heeth',
  'Ingmar', 'Kharst', 'Lesath', 'Mantes', 'Nublaria', 'Omicron', 'Pandion',
  'Skat', 'Troost', 'Ustotu', 'Veil', 'Zosma', 'Acamar', 'Borea', 'Deneb',
];

const SUFFIX = [
  'Prime', 'Creek', 'Secundus', 'III', 'IX', 'Reach', 'Station', 'Belt',
  'Expanse', 'Rift', 'Verge', 'Deep', 'Gate', 'Cradle', 'Nadir', 'Zenith',
  'Waystation', 'Hollow', 'Redoubt', 'March', 'Fields', 'Sink', 'Hold',
];

const SECTOR_NAMES = [
  'Severin', 'Idun', 'Umlaut', 'Andromeda', 'Falstaff', 'Gothmar', 'Jin Xi',
  'Korpus', 'Lacaille', 'Mirin', 'Orion', 'Quintus', 'Rictus', 'Sagan',
  'Talus', 'Ursa', 'Valdis', 'Xzar', 'Ymir', 'Zurga', 'Barnard', 'Cantolus',
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

export function sectorName(rng: { pick<T>(a: readonly T[]): T; int(a: number, b: number): number }): string {
  return `${rng.pick(SECTOR_NAMES)} Sector`;
}
