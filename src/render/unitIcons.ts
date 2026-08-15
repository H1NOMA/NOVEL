// Иконки наземных подразделений и супероружия: бюсты, отрендеренные в Blender
// (tools/blender/unitforge.py) и встроенные в бандл как WEBP с альфой.
// Карточки сил показывают их так же, как флотские карточки — силуэт класса.

import helldivers from '../assets/units/helldivers.webp?url';
import seaf from '../assets/units/seaf.webp?url';
import vsa from '../assets/units/vsa.webp?url';
import incinerators from '../assets/units/incinerators.webp?url';
import jets from '../assets/units/jets.webp?url';
import cyborgLegion from '../assets/units/cyborgLegion.webp?url';
import swarm from '../assets/units/swarm.webp?url';
import breachStrain from '../assets/units/breachStrain.webp?url';
import predatorStrain from '../assets/units/predatorStrain.webp?url';
import sporeStrain from '../assets/units/sporeStrain.webp?url';
import greatFleet from '../assets/units/greatFleet.webp?url';
import voteless from '../assets/units/voteless.webp?url';
import confiscators from '../assets/units/confiscators.webp?url';
import fedArmy from '../assets/units/fedArmy.webp?url';
import fedGuard from '../assets/units/fedGuard.webp?url';
import dss from '../assets/units/dss.webp?url';
import starDestroyer from '../assets/units/starDestroyer.webp?url';
import monolith from '../assets/units/monolith.webp?url';
import superColony from '../assets/units/superColony.webp?url';

/** id подразделения (TROOPS) или супероружия (SPECIALS) → адрес картинки. */
const ICONS: Record<string, string> = {
  helldivers, seaf,
  vsa, incinerators, jets, cyborgLegion,
  swarm, breachStrain, predatorStrain, sporeStrain,
  greatFleet, voteless, confiscators,
  fedArmy, fedGuard,
  dss, starDestroyer, monolith, superColony,
};

export function unitIcon(id: string): string | undefined {
  return ICONS[id];
}
