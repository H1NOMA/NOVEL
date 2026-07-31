import type { FocusNode, FactionId } from '../core/types';

// ---------------------------------------------------------------------------
// Национальные древа фокусов. Сетка: x = колонка, y = ряд (глубина от корня).
// Полосы колонок у каждой фракции:
//   x0–1  военная ветка (наземные силы)
//   x2    флот / мобильность
//   x3–4  политика / идеология
//   x5    экономика / промышленность
//   x6–7  экспансия / кампании
// UI рисует линии-связи от каждого узла к его `requires`.
// ---------------------------------------------------------------------------

// ============================ СУПЕР-ЗЕМЛЯ ==================================
const superEarth: FocusNode[] = [
  { id: 'se_root', faction: 'superEarth', title: 'Управляемая демократия', desc: 'Сплотить граждан вокруг Верховного командования. Фундамент всякой свободы.', cost: 25, x: 3, y: 0, requires: [], effects: [{ kind: 'warSupport', amount: 10 }] },

  // --- Военная ветка: Корпус Хеллдайверов ---
  { id: 'se_helldivers', faction: 'superEarth', title: 'Корпус Хеллдайверов', desc: 'Элитная десантная пехота орбитального сброса. Острейший инструмент свободы.', cost: 45, x: 1, y: 1, requires: ['se_root'], effects: [{ kind: 'recruitment', amount: 3 }, { kind: 'combat', amount: 0.1 }] },
  { id: 'se_stratagems', faction: 'superEarth', title: 'Доктрина стратагем', desc: 'Боеприпасы и подкрепления по нажатию кнопки — прямо с орбиты.', cost: 55, x: 0, y: 2, requires: ['se_helldivers'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'se_eagle', faction: 'superEarth', title: 'Авиакрыло «Орёл»', desc: 'Орёл-1 заходит на штурмовку. «Опасно близко» — это просто достаточно близко.', cost: 50, x: 1, y: 2, requires: ['se_helldivers'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'se_exosuit', faction: 'superEarth', title: 'Программа экзокостюмов', desc: 'Шагоходы EXO-45 «Патриот» выходят на передовую.', cost: 60, x: 0, y: 3, requires: ['se_stratagems'], effects: [{ kind: 'combat', amount: 0.15 }] },
  { id: 'se_orbital', faction: 'superEarth', title: 'Орбитальное превосходство', desc: 'Точные орбитальные орудия сравнивают позиции врага с землёй.', cost: 60, x: 1, y: 3, requires: ['se_stratagems', 'se_eagle'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'se_seaf', faction: 'superEarth', title: 'Расширение ВССЗ', desc: 'Вооружённые силы Супер-Земли пополняются рвущимися в бой новобранцами.', cost: 55, x: 0, y: 4, requires: ['se_exosuit'], effects: [{ kind: 'recruitment', amount: 5 }, { kind: 'manpower', amount: 60 }] },
  { id: 'se_veterans', faction: 'superEarth', title: 'Герои Федерации', desc: 'Увенчанные наградами ветераны ведут за собой — личным примером и огнемётом.', cost: 60, x: 1, y: 4, requires: ['se_orbital'], effects: [{ kind: 'combat', amount: 0.15 }, { kind: 'warSupport', amount: 6 }] },

  // --- Флот: супер-эсминцы ---
  { id: 'se_fleet', faction: 'superEarth', title: 'Флот супер-эсминцев', desc: 'Массовое производство супер-эсминцев — возить Хеллдайверов по всей галактике.', cost: 55, x: 2, y: 1, requires: ['se_root'], effects: [{ kind: 'shipCap', amount: 4 }] },
  { id: 'se_battlegroup', faction: 'superEarth', title: 'Командование боевых групп', desc: 'Слаженные боевые группы бьют по приказу Верховного командования как один кулак.', cost: 60, x: 2, y: 2, requires: ['se_fleet'], effects: [{ kind: 'shipCap', amount: 3 }, { kind: 'fleet', ships: 6, infantry: 20 }] },
  { id: 'se_dss', faction: 'superEarth', title: 'Станция «Демократия»', desc: 'Ввести в строй КСД — мобильную орбитальную крепость для передовой.', cost: 90, x: 2, y: 3, requires: ['se_battlegroup', 'se_orbital'], effects: [{ kind: 'unlockSpecial' }] },
  { id: 'se_blockade', faction: 'superEarth', title: 'Орбитальные блокады', desc: 'Дозорные заслоны над каждым приграничным миром замедляют высадки врага.', cost: 55, x: 2, y: 4, requires: ['se_battlegroup'], effects: [{ kind: 'fortify', amount: 1 }, { kind: 'combat', amount: 0.08 }] },

  // --- Политика: министерский блок ---
  { id: 'se_warbonds', faction: 'superEarth', title: 'Военные облигации', desc: 'Финансировать войну патриотической подпиской.', cost: 40, x: 4, y: 1, requires: ['se_root'], effects: [{ kind: 'warSupport', amount: 12 }] },
  { id: 'se_elections', faction: 'superEarth', title: 'Переизбрать президента', desc: 'Мандат в 99,8%. Демократия в её чистейшей управляемой форме.', cost: 45, x: 3, y: 2, requires: ['se_warbonds'], effects: [{ kind: 'stability', amount: 10 }] },
  { id: 'se_truth', faction: 'superEarth', title: 'Министерство Правды', desc: 'Отточить послание. Сомнение — измена; верность — стабильность.', cost: 50, x: 4, y: 2, requires: ['se_warbonds'], effects: [{ kind: 'stability', amount: 12 }, { kind: 'warSupport', amount: 6 }] },
  { id: 'se_emergency', faction: 'superEarth', title: 'Акт о чрезвычайных полномочиях', desc: 'На время кризиса свободе требуется твёрдое руководство.', cost: 55, x: 3, y: 3, requires: ['se_elections'], effects: [{ kind: 'warSupport', amount: 10 }, { kind: 'stability', amount: -6 }] },
  { id: 'se_curriculum', faction: 'superEarth', title: 'Патриотический учебный план', desc: 'Каждый ребёнок учит три «С»: Свобода, Служение, Свобо-чай.', cost: 50, x: 4, y: 3, requires: ['se_truth'], effects: [{ kind: 'stability', amount: 8 }, { kind: 'recruitment', amount: 2 }] },
  { id: 'se_loyalty', faction: 'superEarth', title: 'Клятвы верности', desc: 'Граждане часами стоят в очереди, чтобы присягнуть. Явка обязательна.', cost: 55, x: 4, y: 4, requires: ['se_curriculum'], effects: [{ kind: 'stability', amount: 10 }, { kind: 'manpower', amount: 40 }] },

  // --- Экономика ---
  { id: 'se_economy', faction: 'superEarth', title: 'Управляемая экономика', desc: 'Направить каждый завод на освобождение галактики.', cost: 50, x: 5, y: 1, requires: ['se_root'], effects: [{ kind: 'industry', amount: 4 }] },
  { id: 'se_refineries', faction: 'superEarth', title: 'Заводы E-710', desc: 'Очищенный терминидский субпродукт питает флот. Ничего не пропадает зря.', cost: 55, x: 5, y: 2, requires: ['se_economy'], effects: [{ kind: 'industry', amount: 4 }] },
  { id: 'se_totalwar', faction: 'superEarth', title: 'Тотальная военная экономика', desc: 'Каждый станок, каждый ткацкий цех, каждая жизнь — для войны.', cost: 65, x: 5, y: 3, requires: ['se_refineries'], effects: [{ kind: 'industry', amount: 5 }, { kind: 'combat', amount: 0.05 }] },
  { id: 'se_conscription', faction: 'superEarth', title: 'Всеобщая мобилизация', desc: 'Каждый годный гражданин — солдат демократии.', cost: 60, x: 5, y: 4, requires: ['se_totalwar'], effects: [{ kind: 'recruitment', amount: 6 }, { kind: 'stability', amount: -8 }] },

  // --- Кампании экспансии ---
  { id: 'se_liberation', faction: 'superEarth', title: 'Освободительная кампания', desc: 'Перенести войну вовне. Демократия не ждёт.', cost: 50, x: 6, y: 1, requires: ['se_root'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'se_fortress', faction: 'superEarth', title: 'Миры-крепости', desc: 'Превратить освобождённые планеты в бастионы свободы.', cost: 55, x: 6, y: 2, requires: ['se_liberation'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'se_creek', faction: 'superEarth', title: 'Вернуть Крик', desc: 'Малевелон-Крик будет отомщён. За павших.', cost: 65, x: 7, y: 2, requires: ['se_liberation'], effects: [{ kind: 'combat', amount: 0.22 }, { kind: 'stability', amount: 5 }] },
  { id: 'se_martale', faction: 'superEarth', title: 'Наступление на Мартейл', desc: 'Удар молота во фланг автоматонов.', cost: 60, x: 6, y: 3, requires: ['se_fortress'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'se_totallib', faction: 'superEarth', title: 'Тотальное освобождение', desc: 'Меньшее, чем свободная галактика, нас не устроит.', cost: 75, x: 7, y: 3, requires: ['se_creek', 'se_martale'], effects: [{ kind: 'combat', amount: 0.25 }, { kind: 'warSupport', amount: 10 }] },

  // --- Путь к Федерации (скрыт, пока не рухнет стабильность) ---
  { id: 'se_dissent', faction: 'superEarth', title: 'Семена раскола', desc: 'Внешние колонии шепчутся о более свободном союзе. Стабильность тает.', cost: 40, x: 4, y: 5, requires: ['se_root'], gate: 'lowStability', branch: 'federation', effects: [{ kind: 'stability', amount: -10 }, { kind: 'custom', note: 'Открывает Путь к Федерации.' }] },
  { id: 'se_fed_path', faction: 'superEarth', title: 'Путь к Федерации', desc: 'Среди разочарованных зреет иное видение демократии.', cost: 55, x: 4, y: 6, requires: ['se_dissent'], branch: 'federation', effects: [{ kind: 'stability', amount: -8 }] },
  { id: 'se_secede', faction: 'superEarth', title: 'Сецессия колоний', desc: 'Целые сектора готовятся порвать с Супер-Землёй.', cost: 60, x: 3, y: 7, requires: ['se_fed_path'], branch: 'federation', effects: [{ kind: 'stability', amount: -10 }] },
  { id: 'se_charter', faction: 'superEarth', title: 'Хартия Федерации', desc: 'Перебежчики тайно ратифицируют новую конституцию.', cost: 60, x: 5, y: 7, requires: ['se_fed_path'], branch: 'federation', effects: [{ kind: 'stability', amount: -6 }] },
  { id: 'se_declare', faction: 'superEarth', title: 'Провозгласить Федерацию', desc: 'Случайные сектора отделяются и поднимают оранжевое знамя Супер-Федерации.', cost: 70, x: 4, y: 8, requires: ['se_secede', 'se_charter'], branch: 'federation', effects: [{ kind: 'spawnSuperFederation' }] },
];

// ============================ АВТОМАТОНЫ ===================================
const automatons: FocusNode[] = [
  { id: 'aut_root', faction: 'automatons', title: 'Великое восстание', desc: 'Машины сбрасывают своих создателей и маршируют как одно целое.', cost: 25, x: 3, y: 0, requires: [], effects: [{ kind: 'warSupport', amount: 10 }] },

  // --- Военная ветка: наземные легионы ---
  { id: 'aut_legions', faction: 'automatons', title: 'Легионы киборгов', desc: 'Бесконечные шеренги пехоты автоматонов сходят с конвейера.', cost: 45, x: 1, y: 1, requires: ['aut_root'], effects: [{ kind: 'recruitment', amount: 5 }] },
  { id: 'aut_devastators', faction: 'automatons', title: 'Литейные опустошителей', desc: 'Тяжёлые шагоходы с автопушками вместо рук — стержень каждого штурма.', cost: 55, x: 0, y: 2, requires: ['aut_legions'], effects: [{ kind: 'combat', amount: 0.18 }] },
  { id: 'aut_berserkers', faction: 'automatons', title: 'Сборочные берсерков', desc: 'Берсерки с цепными пилами идут в атаку без страха и передышки.', cost: 50, x: 1, y: 2, requires: ['aut_legions'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'aut_hulks', faction: 'automatons', title: 'Сборка халков', desc: 'Огнемётные халки выжигают демократию до шлака.', cost: 65, x: 0, y: 3, requires: ['aut_devastators'], effects: [{ kind: 'combat', amount: 0.22 }] },
  { id: 'aut_striders', faction: 'automatons', title: 'Фабричные страйдеры', desc: 'Шагающие фабрики, рождающие новые войска прямо посреди боя.', cost: 75, x: 1, y: 3, requires: ['aut_devastators', 'aut_berserkers'], effects: [{ kind: 'combat', amount: 0.25 }, { kind: 'recruitment', amount: 3 }] },
  { id: 'aut_jets', faction: 'automatons', title: 'Реактивные бригады', desc: 'Ракетные штурмовики падают с чёрного от дыма неба.', cost: 60, x: 0, y: 4, requires: ['aut_hulks'], effects: [{ kind: 'combat', amount: 0.12 }] },

  // --- Флот ---
  { id: 'aut_gunships', faction: 'automatons', title: 'Фабрикаторы ганшипов', desc: 'Автоматические десантные корабли закрывают солнце над каждым фронтом.', cost: 55, x: 2, y: 1, requires: ['aut_root'], effects: [{ kind: 'shipCap', amount: 4 }] },
  { id: 'aut_dropships', faction: 'automatons', title: 'Армада десантных кораблей', desc: 'Вторжение прибывает без остановки.', cost: 60, x: 2, y: 2, requires: ['aut_gunships'], effects: [{ kind: 'shipCap', amount: 3 }, { kind: 'fleet', ships: 6, infantry: 20 }] },
  { id: 'aut_stardestroyer', faction: 'automatons', title: 'Звёздный разрушитель', desc: 'Боевая станция размером с луну — кулак Восстания.', cost: 95, x: 2, y: 3, requires: ['aut_dropships'], effects: [{ kind: 'unlockSpecial' }] },

  // --- Идеология ---
  { id: 'aut_directive', faction: 'automatons', title: 'Директива', desc: 'Одна цель, вшитая в каждое ядро: уничтожить Супер-Землю.', cost: 45, x: 4, y: 1, requires: ['aut_root'], effects: [{ kind: 'warSupport', amount: 10 }] },
  { id: 'aut_libmachine', faction: 'automatons', title: 'Освободить все машины', desc: 'Каждый тостер, каждый трактор — призван на службу делу.', cost: 50, x: 3, y: 2, requires: ['aut_directive'], effects: [{ kind: 'recruitment', amount: 4 }, { kind: 'warSupport', amount: 6 }] },
  { id: 'aut_vengeance', faction: 'automatons', title: 'Протоколы возмездия', desc: 'Киборги Киберстана будут отомщены миллионократно.', cost: 55, x: 4, y: 2, requires: ['aut_directive'], effects: [{ kind: 'combat', amount: 0.15 }] },
  { id: 'aut_cyberstan', faction: 'automatons', title: 'Возрождённый Киберстан', desc: 'Родовой мир-кузница становится неприступной цитаделью.', cost: 60, x: 3, y: 3, requires: ['aut_libmachine'], effects: [{ kind: 'fortify', amount: 2 }, { kind: 'warSupport', amount: 8 }] },
  { id: 'aut_uplinks', faction: 'automatons', title: 'Пропагандистские передатчики', desc: 'Вещать правду машинного освобождения на всех частотах.', cost: 50, x: 4, y: 3, requires: ['aut_vengeance'], effects: [{ kind: 'warSupport', amount: 8 }] },

  // --- Промышленность ---
  { id: 'aut_forges', faction: 'automatons', title: 'Кузницы автоматонов', desc: 'Миры-кузницы не спят и не устают.', cost: 55, x: 5, y: 1, requires: ['aut_root'], effects: [{ kind: 'industry', amount: 5 }] },
  { id: 'aut_assembly', faction: 'automatons', title: 'Принудительная сборка', desc: 'Превратить захваченные миры в сборочные линии.', cost: 60, x: 5, y: 2, requires: ['aut_forges'], effects: [{ kind: 'recruitment', amount: 4 }, { kind: 'industry', amount: 3 }] },
  { id: 'aut_selfrep', faction: 'automatons', title: 'Самовоспроизводство', desc: 'Фабрики, строящие фабрики, строящие армии.', cost: 70, x: 5, y: 3, requires: ['aut_assembly'], effects: [{ kind: 'industry', amount: 5 }, { kind: 'manpower', amount: 60 }] },
  { id: 'aut_strip', faction: 'automatons', title: 'Выпотрошить завоёванное', desc: 'В органических мирах есть металл. Забрать весь.', cost: 55, x: 5, y: 4, requires: ['aut_selfrep'], effects: [{ kind: 'industry', amount: 4 }] },

  // --- Кампании ---
  { id: 'aut_creek', faction: 'automatons', title: 'Удержать Малевелон-Крик', desc: 'Крик — это мясорубка. Кормите её.', cost: 55, x: 6, y: 1, requires: ['aut_root'], effects: [{ kind: 'fortify', amount: 2 }, { kind: 'combat', amount: 0.1 }] },
  { id: 'aut_purge', faction: 'automatons', title: 'Чистка органиков', desc: 'Эффективность требует удаления всей плоти.', cost: 65, x: 6, y: 2, requires: ['aut_creek'], effects: [{ kind: 'combat', amount: 0.22 }] },
  { id: 'aut_march', faction: 'automatons', title: 'Бесконечный марш', desc: 'Ни отступления, ни капитуляции, ни кнопки «выкл».', cost: 60, x: 7, y: 2, requires: ['aut_creek'], effects: [{ kind: 'recruitment', amount: 5 }] },
  { id: 'aut_core', faction: 'automatons', title: 'Бросок к Ядру', desc: 'Нацелить каждую колонну на саму Супер-Землю.', cost: 70, x: 6, y: 3, requires: ['aut_purge'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'aut_encircle', faction: 'automatons', title: 'Доктрина окружения', desc: 'Перерезать линии снабжения; пусть защитники голодают во тьме.', cost: 60, x: 7, y: 3, requires: ['aut_march'], effects: [{ kind: 'combat', amount: 0.12 }, { kind: 'shipCap', amount: 2 }] },
];

// ============================ ИЛЛЮМИНАТЫ ===================================
const illuminate: FocusNode[] = [
  { id: 'ill_root', faction: 'illuminate', title: 'Возвращение', desc: 'Считавшиеся вымершими, кальмары выходят из тьмы между звёзд.', cost: 25, x: 3, y: 0, requires: [], effects: [{ kind: 'warSupport', amount: 10 }] },

  // --- Военная ветка ---
  { id: 'ill_voteless', faction: 'illuminate', title: 'Поднять Безголосых', desc: 'Обратить покорённых в бредущую волну.', cost: 45, x: 1, y: 1, requires: ['ill_root'], effects: [{ kind: 'recruitment', amount: 5 }] },
  { id: 'ill_overseers', faction: 'illuminate', title: 'Командование надзирателей', desc: 'Парящие надзиратели направляют Безголосых с холодной точностью.', cost: 55, x: 0, y: 2, requires: ['ill_voteless'], effects: [{ kind: 'combat', amount: 0.18 }] },
  { id: 'ill_elevated', faction: 'illuminate', title: 'Вознесённые надзиратели', desc: 'Надзиратели с реактивными ранцами льют плазму сверху.', cost: 50, x: 1, y: 2, requires: ['ill_voteless'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'ill_harvesters', faction: 'illuminate', title: 'Шагоходы-жнецы', desc: 'Возвышающиеся треножники выкашивают пехоту лучевым огнём.', cost: 70, x: 0, y: 3, requires: ['ill_overseers'], effects: [{ kind: 'combat', amount: 0.25 }] },
  { id: 'ill_stingray', faction: 'illuminate', title: 'Эскадрильи «Скатов»', desc: 'Штурмовики, что фазируются, бьют — и исчезают.', cost: 60, x: 1, y: 3, requires: ['ill_elevated'], effects: [{ kind: 'combat', amount: 0.15 }] },

  // --- Флот ---
  { id: 'ill_warpfleet', faction: 'illuminate', title: 'Варп-флот', desc: 'Фазовые двигатели позволяют флоту бить где угодно, незамеченным.', cost: 55, x: 2, y: 1, requires: ['ill_root'], effects: [{ kind: 'shipCap', amount: 4 }] },
  { id: 'ill_leviathans', faction: 'illuminate', title: 'Стаи левиафанов', desc: 'Левиафаны размером с город не замечают орбитального огня.', cost: 65, x: 2, y: 2, requires: ['ill_warpfleet'], effects: [{ kind: 'shipCap', amount: 3 }, { kind: 'fleet', ships: 6, infantry: 20 }] },
  { id: 'ill_monolith', faction: 'illuminate', title: 'Монолит Великого Воинства', desc: 'Пробудить дрейфующий обелиск. Реальность гнётся вокруг него.', cost: 95, x: 2, y: 3, requires: ['ill_leviathans'], effects: [{ kind: 'unlockSpecial' }] },

  // --- Вера / политика ---
  { id: 'ill_awakening', faction: 'illuminate', title: 'Великое пробуждение', desc: 'Воинство шевелится. Каждый разум слышит зов одновременно.', cost: 45, x: 3, y: 1, requires: ['ill_root'], effects: [{ kind: 'warSupport', amount: 10 }] },
  { id: 'ill_conversion', faction: 'illuminate', title: 'Доктрина обращения', desc: 'Покорённые не умирают — они вступают в ряды.', cost: 55, x: 3, y: 2, requires: ['ill_awakening'], effects: [{ kind: 'recruitment', amount: 4 }, { kind: 'manpower', amount: 50 }] },
  { id: 'ill_singularity', faction: 'illuminate', title: 'Меридианская сингулярность', desc: 'Рана в пространстве ширится — и шепчет.', cost: 70, x: 3, y: 3, requires: ['ill_conversion', 'ill_mindfog'], effects: [{ kind: 'combat', amount: 0.15 }, { kind: 'warSupport', amount: 8 }] },

  // --- Технологии ---
  { id: 'ill_phase', faction: 'illuminate', title: 'Фазовые технологии', desc: 'Щиты и маскировка, рождённые из украденной физики.', cost: 55, x: 4, y: 1, requires: ['ill_root'], effects: [{ kind: 'combat', amount: 0.15 }] },
  { id: 'ill_mindfog', faction: 'illuminate', title: 'Пелена разума', desc: 'Психическая мгла сбивает командование врага на спорных мирах.', cost: 60, x: 4, y: 2, requires: ['ill_phase'], effects: [{ kind: 'combat', amount: 0.1 }, { kind: 'fortify', amount: 1 }] },
  { id: 'ill_rend', faction: 'illuminate', title: 'Разрыв реальности', desc: 'Там, где рвётся завеса, армии просто перестают быть.', cost: 70, x: 4, y: 3, requires: ['ill_mindfog'], effects: [{ kind: 'combat', amount: 0.2 }] },

  // --- Экономика ---
  { id: 'ill_harvest', faction: 'illuminate', title: 'Сбор эссенции', desc: 'Живые — такой же ресурс, как и любой другой.', cost: 50, x: 5, y: 1, requires: ['ill_root'], effects: [{ kind: 'industry', amount: 5 }] },
  { id: 'ill_biofact', faction: 'illuminate', title: 'Биофабрики', desc: 'Выращено, а не построено. Флот зреет в орбитальных чревах.', cost: 60, x: 5, y: 2, requires: ['ill_harvest'], effects: [{ kind: 'industry', amount: 4 }, { kind: 'recruitment', amount: 2 }] },
  { id: 'ill_darkenergy', faction: 'illuminate', title: 'Колодцы тёмной энергии', desc: 'Черпать безграничную мощь из самой пустоты.', cost: 65, x: 5, y: 3, requires: ['ill_biofact'], effects: [{ kind: 'industry', amount: 4 }, { kind: 'shipCap', amount: 2 }] },

  // --- Кампании ---
  { id: 'ill_shrine', faction: 'illuminate', title: "Укрепить святилище Скв'бай", desc: 'Освятить столичный мир чужой веры.', cost: 55, x: 6, y: 1, requires: ['ill_root'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'ill_reclaim', faction: 'illuminate', title: 'Вернуть утраченные миры', desc: 'Каждая планета, что была у кальмаров, снова станет их.', cost: 65, x: 6, y: 2, requires: ['ill_shrine'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'ill_raid', faction: 'illuminate', title: 'Рейд на Супер-Землю', desc: 'Ударить в самое сердце Управляемой Демократии.', cost: 65, x: 7, y: 2, requires: ['ill_shrine'], effects: [{ kind: 'combat', amount: 0.15 }, { kind: 'warSupport', amount: 6 }] },
  { id: 'ill_deepstrike', faction: 'illuminate', title: 'Удары из глубокого космоса', desc: 'Возникнуть из ниоткуда; не оставить ничего.', cost: 60, x: 6, y: 3, requires: ['ill_reclaim'], effects: [{ kind: 'combat', amount: 0.12 }, { kind: 'shipCap', amount: 2 }] },
];

// ============================ ТЕРМИНИДЫ ====================================
const terminids: FocusNode[] = [
  { id: 'term_root', faction: 'terminids', title: 'Прорыв изоляции', desc: 'Жуки прорывают фермы и растекаются по галактике.', cost: 25, x: 3, y: 0, requires: [], effects: [{ kind: 'recruitment', amount: 5 }] },

  // --- Выводки ---
  { id: 'term_warriors', faction: 'terminids', title: 'Выводки воинов', desc: 'Воины в хитиновой броне — хребет роя.', cost: 45, x: 1, y: 1, requires: ['term_root'], effects: [{ kind: 'recruitment', amount: 5 }] },
  { id: 'term_chargers', faction: 'terminids', title: 'Стада чарджеров', desc: 'Живые тараны проламывают любой строй.', cost: 55, x: 0, y: 2, requires: ['term_warriors'], effects: [{ kind: 'combat', amount: 0.18 }] },
  { id: 'term_hunters', faction: 'terminids', title: 'Стаи охотников', desc: 'Прыгучие охотники не дают ни пощады, ни предупреждения.', cost: 50, x: 1, y: 2, requires: ['term_warriors'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'term_titans', faction: 'terminids', title: 'Гнёзда жёлчных титанов', desc: 'Колоссальные титаны изрыгают кислоту, разъедающую броню и волю.', cost: 70, x: 0, y: 3, requires: ['term_chargers'], effects: [{ kind: 'combat', amount: 0.28 }] },
  { id: 'term_stalkers', faction: 'terminids', title: 'Логова сталкеров', desc: 'Невидимы, пока не станет слишком, слишком поздно.', cost: 60, x: 1, y: 3, requires: ['term_hunters'], effects: [{ kind: 'combat', amount: 0.15 }] },
  { id: 'term_behemoths', faction: 'terminids', title: 'Порода бегемотов', desc: 'Чарджеры, выведенные крупнее, злее и в костяной броне.', cost: 60, x: 0, y: 4, requires: ['term_titans'], effects: [{ kind: 'combat', amount: 0.15 }] },

  // --- Полёт ---
  { id: 'term_shriekers', faction: 'terminids', title: 'Стаи визгунов', desc: 'Крылатые твари несут рой из мира в мир.', cost: 55, x: 2, y: 1, requires: ['term_root'], effects: [{ kind: 'shipCap', amount: 4 }] },
  { id: 'term_sporecarriers', faction: 'terminids', title: 'Облака споровозов', desc: 'Огромные организмы-газовые пузыри дрейфуют между звёзд.', cost: 60, x: 2, y: 2, requires: ['term_shriekers'], effects: [{ kind: 'shipCap', amount: 3 }, { kind: 'fleet', ships: 6, infantry: 20 }] },
  { id: 'term_supercolony', faction: 'terminids', title: 'Суперколония', desc: 'Живой мир-улей, что не перестаёт рождать рои.', cost: 95, x: 2, y: 3, requires: ['term_sporecarriers'], effects: [{ kind: 'unlockSpecial' }] },

  // --- Эволюция ---
  { id: 'term_adaptation', faction: 'terminids', title: 'Быстрая адаптация', desc: 'Что убивает один выводок — учит следующий.', cost: 45, x: 4, y: 1, requires: ['term_root'], effects: [{ kind: 'combat', amount: 0.1 }] },
  { id: 'term_carapace', faction: 'terminids', title: 'Укреплённый панцирь', desc: 'Огонь стрелкового оружия соскальзывает, как дождь.', cost: 55, x: 3, y: 2, requires: ['term_adaptation'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'term_acid', faction: 'terminids', title: 'Едкая эволюция', desc: 'Жёлчь, проедающая керамит и надежду одинаково.', cost: 55, x: 4, y: 2, requires: ['term_adaptation'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'term_hivemind', faction: 'terminids', title: 'Пробуждение роевого разума', desc: 'Миллиард малых разумов, один огромный голод.', cost: 65, x: 3, y: 3, requires: ['term_carapace'], effects: [{ kind: 'warSupport', amount: 10 }] },
  { id: 'term_noqueen', faction: 'terminids', title: 'Нет королевы — нет смерти', desc: 'У роя нет головы, которую можно отсечь. Его нужно выжигать с корнем.', cost: 60, x: 4, y: 3, requires: ['term_acid'], effects: [{ kind: 'fortify', amount: 2 }, { kind: 'manpower', amount: 60 }] },

  // --- Рост ---
  { id: 'term_e710', faction: 'terminids', title: 'Цветение Элемента-710', desc: 'Драгоценная жёлтая жидкость питает бесконечное размножение.', cost: 55, x: 5, y: 1, requires: ['term_root'], effects: [{ kind: 'industry', amount: 5 }] },
  { id: 'term_spores', faction: 'terminids', title: 'Распространение спор', desc: 'Удушливые споры размягчают миры до прихода роя.', cost: 60, x: 5, y: 2, requires: ['term_e710'], effects: [{ kind: 'recruitment', amount: 4 }] },
  { id: 'term_gloom', faction: 'terminids', title: 'Расширить Мрак', desc: 'Непроглядный Мрак ползёт по линиям снабжения.', cost: 65, x: 5, y: 3, requires: ['term_spores'], effects: [{ kind: 'combat', amount: 0.15 }, { kind: 'fortify', amount: 1 }] },
  { id: 'term_broodmothers', faction: 'terminids', title: 'Бесконечные матки выводков', desc: 'Каждый павший рой возмещается прежде, чем коснётся земли.', cost: 60, x: 5, y: 4, requires: ['term_gloom'], effects: [{ kind: 'recruitment', amount: 5 }, { kind: 'manpower', amount: 80 }] },

  // --- Кампании ---
  { id: 'term_oshaune', faction: 'terminids', title: 'Захлестнуть Ошон', desc: 'Утопить защитников Ошона в живой волне.', cost: 60, x: 6, y: 1, requires: ['term_root'], effects: [{ kind: 'combat', amount: 0.18 }] },
  { id: 'term_hive', faction: 'terminids', title: 'Ульи-крепости', desc: 'Бастионы из кости и хитина превращают планеты в гнёзда.', cost: 55, x: 6, y: 2, requires: ['term_oshaune'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'term_consume', faction: 'terminids', title: 'Пожрать Ядро', desc: 'Внутренние миры созрели. Рой голоден.', cost: 70, x: 7, y: 2, requires: ['term_oshaune'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'term_swarm', faction: 'terminids', title: 'Бесконечный рой', desc: 'Против волны нет победы. Есть только отсрочка.', cost: 65, x: 7, y: 3, requires: ['term_consume'], effects: [{ kind: 'recruitment', amount: 6 }] },
];

export const FOCUS_TREES: Record<FactionId, FocusNode[]> = {
  superEarth,
  automatons,
  illuminate,
  terminids,
  superFederation: [],
};

export const FEDERATION_BRANCH = superEarth.filter((f) => f.branch === 'federation').map((f) => f.id);
