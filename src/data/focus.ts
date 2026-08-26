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
  { id: 'se_root', faction: 'superEarth', title: 'Управляемая демократия', desc: 'Демократия управляемая — то есть избавленная от неудобного этапа, на котором граждане выбирают неправильно. Явка добровольная и обязательная.', cost: 25, x: 3, y: 0, requires: [], effects: [{ kind: 'warSupport', amount: 10 }] },

  // --- Военная ветка: Корпус Хеллдайверов ---
  { id: 'se_helldivers', faction: 'superEarth', title: 'Корпус Хеллдайверов', desc: 'Средняя продолжительность службы хеллдайвера — четыре минуты. Средняя продолжительность вступительного ролика — шесть. Набор идёт с опережением плана.', cost: 45, x: 1, y: 1, requires: ['se_root'], effects: [{ kind: 'recruitment', amount: 3 }, { kind: 'combat', amount: 0.1 }] },
  { id: 'se_stratagems', faction: 'superEarth', title: 'Доктрина стратагем', desc: 'Подкрепление вызывается шестью нажатиями. Ошибка на четвёртом нажатии тоже вызывает подкрепление — только не вам и не туда.', cost: 55, x: 0, y: 2, requires: ['se_helldivers'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'se_eagle', faction: 'superEarth', title: 'Авиакрыло «Орёл»', desc: 'Орёл-1 заходит на цель. «Опасно близко» — официальный термин, означающий «в пределах допустимых потерь среди своих».', cost: 50, x: 1, y: 2, requires: ['se_helldivers'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'se_exosuit', faction: 'superEarth', title: 'Программа экзокостюмов', desc: 'EXO-45 «Патриот»: две ракетные установки, пулемёт и ни одного зеркала заднего вида. Оглядываться — не по-демократически.', cost: 60, x: 0, y: 3, requires: ['se_stratagems'], effects: [{ kind: 'combat', amount: 0.15 }] },
  { id: 'se_orbital', faction: 'superEarth', title: 'Орбитальное превосходство', desc: 'Орбитальные орудия бьют с точностью до квартала. Квартал определяется как область, которую видно с орбиты.', cost: 60, x: 1, y: 3, requires: ['se_stratagems', 'se_eagle', 'se_fleet'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'se_seaf', faction: 'superEarth', title: 'Расширение ВССЗ', desc: 'ВССЗ принимает всех: годных, условно годных и тех, кто просто оказался рядом с вербовочным пунктом.', cost: 55, x: 0, y: 4, requires: ['se_exosuit'], effects: [{ kind: 'recruitment', amount: 5 }, { kind: 'manpower', amount: 60 }] },
  { id: 'se_veterans', faction: 'superEarth', title: 'Герои Федерации', desc: 'Ветеран — это боец, переживший три высадки. По статистике таких меньше, чем разновидностей нашивок за них.', cost: 60, x: 1, y: 4, requires: ['se_orbital'], effects: [{ kind: 'combat', amount: 0.15 }, { kind: 'warSupport', amount: 6 }] },
  { id: 'se_requalification', faction: 'superEarth', title: 'Повышение квалификации', desc: 'Аналитический отдел докладывает: багдайверы показывают низкую эффективность против прочих фракций. К каждому отряду приписывается ботдайвер-наставник — до уничтожения десяти шагоходов из одноразового бронебоя. Бронебой сдать после использования.', cost: 40, x: 3, y: 5, requires: ['se_veterans', 'se_truth'], effects: [{ kind: 'combat', amount: 0.08 }, { kind: 'recruitment', amount: 2 }] },

  // --- Флот: супер-эсминцы ---
  { id: 'se_fleet', faction: 'superEarth', title: 'Флот супер-эсминцев', desc: 'Каждому супер-эсминцу присваивается гордое имя. Список имён утверждён заранее на двести лет вперёд — с запасом на потери.', cost: 55, x: 2, y: 1, requires: ['se_root'], effects: [{ kind: 'shipCap', amount: 4 }] },
  { id: 'se_battlegroup', faction: 'superEarth', title: 'Командование боевых групп', desc: 'Боевая группа действует как единый кулак. Пальцы кулака согласовываются между собой по защищённому каналу с задержкой в три дня.', cost: 60, x: 2, y: 2, requires: ['se_fleet'], effects: [{ kind: 'shipCap', amount: 3 }, { kind: 'fleet', ships: 6, infantry: 20 }] },
  { id: 'se_dss', faction: 'superEarth', title: 'Станция DSS', desc: 'Демократическая космическая станция. Существует в единственном экземпляре, потому что бюджет на вторую ушёл на празднование ввода в строй первой.', cost: 90, x: 2, y: 3, requires: ['se_battlegroup', 'se_orbital'], effects: [{ kind: 'unlockSpecial' }] },
  { id: 'se_blockade', faction: 'superEarth', title: 'Орбитальные блокады', desc: 'Приграничные миры получают орбитальный дозор. Дозор фиксирует вторжение, докладывает о вторжении и героически гибнет — строго в этом порядке.', cost: 55, x: 2, y: 4, requires: ['se_battlegroup', 'se_warbonds'], effects: [{ kind: 'fortify', amount: 1 }, { kind: 'combat', amount: 0.08 }] },

  // --- Политика: министерский блок ---
  { id: 'se_warbonds', faction: 'superEarth', title: 'Военные облигации', desc: 'Патриотическая подписка: гражданин добровольно отдаёт часть дохода на войну. Отказавшимся присылают благодарственное письмо и повестку.', cost: 40, x: 4, y: 1, requires: ['se_root'], effects: [{ kind: 'warSupport', amount: 12 }] },
  { id: 'se_elections', faction: 'superEarth', title: 'Переизбрать президента', desc: 'Президент переизбран с результатом 99,8%. Оставшиеся 0,2% признаны опечаткой и подлежат перевоспитанию.', cost: 45, x: 3, y: 2, requires: ['se_warbonds'], effects: [{ kind: 'stability', amount: 10 }] },
  { id: 'se_truth', faction: 'superEarth', title: 'Министерство Правды', desc: 'Министерство Правды не сочиняет новости. Оно лишь заранее знает, какими они окажутся.', cost: 50, x: 4, y: 2, requires: ['se_warbonds'], effects: [{ kind: 'stability', amount: 12 }, { kind: 'warSupport', amount: 6 }] },
  { id: 'se_emergency', faction: 'superEarth', title: 'Акт о чрезвычайных полномочиях', desc: 'Чрезвычайные полномочия вводятся на срок кризиса. Срок кризиса определяется обладателем чрезвычайных полномочий.', cost: 55, x: 3, y: 3, requires: ['se_elections'], effects: [{ kind: 'warSupport', amount: 10 }, { kind: 'stability', amount: -6 }] },
  { id: 'se_curriculum', faction: 'superEarth', title: 'Патриотический учебный план', desc: 'Три «С» школьной программы: Свобода, Служение и Свобо-чай. Четвёртое «С» — «Сомнение» — изъято из алфавита.', cost: 50, x: 4, y: 3, requires: ['se_truth'], effects: [{ kind: 'stability', amount: 8 }, { kind: 'recruitment', amount: 2 }] },
  { id: 'se_loyalty', faction: 'superEarth', title: 'Клятвы верности', desc: 'Граждане стоят в очереди на присягу по восемь часов. Очередь тоже считается формой служения и засчитывается в стаж.', cost: 55, x: 4, y: 4, requires: ['se_curriculum'], effects: [{ kind: 'stability', amount: 10 }, { kind: 'manpower', amount: 40 }] },

  // --- Экономика ---
  { id: 'se_economy', faction: 'superEarth', title: 'Управляемая экономика', desc: 'Экономика управляемая: рынок сам решает, что производить, а Верховное командование сообщает рынку правильное решение.', cost: 50, x: 5, y: 1, requires: ['se_root'], effects: [{ kind: 'industry', amount: 4 }] },
  { id: 'se_refineries', faction: 'superEarth', title: 'Заводы E-710', desc: 'Э-710 качают из планет, которые всё равно уже никому не нужны. Список ненужных планет обновляется по мере роста потребности в Э-710.', cost: 55, x: 5, y: 2, requires: ['se_economy'], effects: [{ kind: 'industry', amount: 4 }] },
  { id: 'se_totalwar', faction: 'superEarth', title: 'Тотальная военная экономика', desc: 'Производится всё, что нужно фронту. Всё остальное объявлено не нужным фронту.', cost: 65, x: 5, y: 3, requires: ['se_refineries'], effects: [{ kind: 'industry', amount: 5 }, { kind: 'combat', amount: 0.05 }] },
  { id: 'se_conscription', faction: 'superEarth', title: 'Всеобщая мобилизация', desc: 'Всеобщая мобилизация распространяется на граждан от 16 до 70. Верхняя граница пересматривается ежеквартально в сторону оптимизма.', cost: 60, x: 5, y: 4, requires: ['se_totalwar'], effects: [{ kind: 'recruitment', amount: 6 }, { kind: 'stability', amount: -8 }] },

  // --- Кампании экспансии ---
  { id: 'se_liberation', faction: 'superEarth', title: 'Освободительная кампания', desc: 'Освобождение — это возвращение мира в состав Супер-Земли независимо от того, был ли он когда-либо в её составе.', cost: 50, x: 6, y: 1, requires: ['se_root'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'se_fortress', faction: 'superEarth', title: 'Миры-крепости', desc: 'Мир-крепость обороняется до последнего гражданина. Гражданам об этом сообщают в момент высадки противника.', cost: 55, x: 6, y: 2, requires: ['se_liberation'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'se_creek', faction: 'superEarth', title: 'Вернуть Крик', desc: 'Малевелон-Крик. Восемь месяцев, три волны, ни одного отчёта без слова «джунгли». Возвращаемся туда, где нас так ждут.', cost: 65, x: 7, y: 2, requires: ['se_liberation'], effects: [{ kind: 'combat', amount: 0.22 }, { kind: 'stability', amount: 5 }] },
  { id: 'se_martale', faction: 'superEarth', title: 'Наступление на Мартейл', desc: 'Наступление на Мартейл спланировано штабом, ни разу не бывавшим на Мартейле. Это считается преимуществом: никаких предубеждений.', cost: 60, x: 6, y: 3, requires: ['se_fortress'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'se_totallib', faction: 'superEarth', title: 'Тотальное освобождение', desc: 'Галактика становится свободной целиком. Несогласные регионы освобождаются в первую очередь.', cost: 75, x: 7, y: 3, requires: ['se_creek', 'se_martale'], effects: [{ kind: 'combat', amount: 0.25 }, { kind: 'warSupport', amount: 10 }] },

  // --- Западный фронт: война с автоматонами ---
  { id: 'se_av_front', faction: 'superEarth', title: 'Западный фронт', desc: 'Западный фронт против машин. Направление «запад» условно: в космосе его определили голосованием.', cost: 50, x: 0, y: 5, requires: ['se_liberation'], effects: [{ kind: 'combat', amount: 0.08 }] },
  { id: 'se_av_ap', faction: 'superEarth', title: 'Бронебойный арсенал', desc: 'Бронебойный арсенал разработан по итогам изучения брони противника. Противник изучил наши выводы и обновил броню.', cost: 55, x: 1, y: 5, requires: ['se_av_front'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'se_av_emp', faction: 'superEarth', title: 'ЭМИ-стратагемы', desc: 'ЭМИ-стратагема отключает машину на четыре секунды. За четыре секунды хеллдайвер успевает выстрелить дважды или испугаться трижды.', cost: 55, x: 0, y: 6, requires: ['se_av_front'], effects: [{ kind: 'combat', amount: 0.08 }, { kind: 'fortify', amount: 1 }] },
  { id: 'se_av_wall', faction: 'superEarth', title: 'Вал Малевелона', desc: 'Линия укреплений в джунглях, где укрепления зарастают быстрее, чем строятся.', cost: 60, x: 1, y: 6, requires: ['se_av_ap'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'se_av_march', faction: 'superEarth', title: 'Марш на Киберстан', desc: 'Планета, с которой всё началось, и планета, на которой всё, по плану, закончится.', cost: 70, x: 0, y: 7, requires: ['se_av_emp', 'se_av_wall'], effects: [{ kind: 'combat', amount: 0.2 }] },

  // --- Флот Возмездия: война с иллюминатами ---
  { id: 'se_ai_shield', faction: 'superEarth', title: 'Контрфазовые щиты', desc: 'Контрфазовые щиты гасят варп-удар. Как именно — в отчёте написано «удовлетворительно» и подпись неразборчива.', cost: 55, x: 2, y: 5, requires: ['se_blockade'], effects: [{ kind: 'combat', amount: 0.1 }] },
  { id: 'se_ai_intel', faction: 'superEarth', title: 'Разведуправление «Спрут»', desc: 'Управление «Спрут» следит за иллюминатами. За самим «Спрутом» следит другое управление, название которого не рассекречено.', cost: 55, x: 2, y: 6, requires: ['se_ai_shield'], effects: [{ kind: 'warSupport', amount: 6 }, { kind: 'combat', amount: 0.08 }] },
  { id: 'se_ai_hunt', faction: 'superEarth', title: 'Охота на кальмаров', desc: 'Термин утверждён отделом пропаганды после того, как «охота на превосходящего противника» плохо прошла фокус-группу.', cost: 65, x: 2, y: 7, requires: ['se_ai_intel'], effects: [{ kind: 'combat', amount: 0.18 }] },

  // --- Восточный фронт: война с терминидами ---
  { id: 'se_at_pest', faction: 'superEarth', title: 'Тотальная дезинсекция', desc: 'Дезинсекция в галактических масштабах. Инструкция та же, что для домашней, только цифры больше и жуки крупнее.', cost: 50, x: 6, y: 5, requires: ['se_fortress'], effects: [{ kind: 'combat', amount: 0.1 }] },
  { id: 'se_at_napalm', faction: 'superEarth', title: 'Напалмовые заграждения', desc: 'Напалмовое заграждение выжигает всё живое в полосе. Полоса определяется ветром, а ветер согласований не проходит.', cost: 55, x: 7, y: 5, requires: ['se_at_pest'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'se_at_gloomtech', faction: 'superEarth', title: 'Прорыв Мрака', desc: 'В споровых тучах связь пропадает, приборы врут, а бодрость духа, согласно уставу, остаётся неизменной.', cost: 80, x: 6, y: 6, requires: ['se_at_pest'], effects: [{ kind: 'flag', flag: 'gloomTravel' }] },
  { id: 'se_at_e710', faction: 'superEarth', title: 'Жатва Э-710', desc: 'Терминиды перерабатываются в топливо. Круговорот, в котором жуки любезно участвуют посмертно.', cost: 55, x: 7, y: 6, requires: ['se_at_napalm'], effects: [{ kind: 'industry', amount: 4 }] },
  { id: 'se_at_exterm', faction: 'superEarth', title: 'Протокол истребления', desc: 'Протокол истребления не предусматривает пленных. Терминиды, впрочем, тоже никогда об этом не спрашивали.', cost: 70, x: 7, y: 7, requires: ['se_at_gloomtech', 'se_at_e710'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'se_at_termicide', faction: 'superEarth', title: 'Термицид', desc: 'Одно вещество, вся галактика, полный успех. Побочные эффекты изучаются параллельно с применением.', cost: 75, x: 6, y: 7, requires: ['se_at_gloomtech'], effects: [{ kind: 'flag', flag: 'termicide' }] },

  // --- Путь к Федерации (скрыт, пока не рухнет стабильность) ---
  { id: 'se_dissent', faction: 'superEarth', title: 'Семена раскола', desc: 'Раскол в стане врага — лучший союзник свободы. Раскол в своём стане — статья.', cost: 40, x: 4, y: 5, requires: ['se_root'], gate: 'lowStability', branch: 'federation', effects: [{ kind: 'stability', amount: -10 }, { kind: 'custom', note: 'Открывает Путь к Федерации.' }] },
  { id: 'se_fed_path', faction: 'superEarth', title: 'Путь к Федерации', desc: 'Колонии получают представительство, а Супер-Земля — колонии, довольные представительством.', cost: 55, x: 4, y: 6, requires: ['se_dissent'], branch: 'federation', effects: [{ kind: 'stability', amount: -8 }] },
  { id: 'se_secede', faction: 'superEarth', title: 'Сецессия колоний', desc: 'Колонии заявляют о выходе. Верховное командование заявляет, что это была его идея.', cost: 60, x: 3, y: 7, requires: ['se_fed_path'], branch: 'federation', effects: [{ kind: 'stability', amount: -10 }] },
  { id: 'se_charter', faction: 'superEarth', title: 'Хартия Федерации', desc: 'Хартия Федерации умещается на одной странице. Приложения к ней — на четырнадцати тысячах.', cost: 60, x: 5, y: 7, requires: ['se_fed_path'], branch: 'federation', effects: [{ kind: 'stability', amount: -6 }] },
  { id: 'se_declare', faction: 'superEarth', title: 'Провозгласить Федерацию', desc: 'Провозглашение Федерации. Флаг новый, гимн новый, Верховное командование прежнее.', cost: 70, x: 4, y: 8, requires: ['se_secede', 'se_charter'], branch: 'federation', effects: [{ kind: 'spawnSuperFederation' }] },
  { id: 'se_good_neighbour', faction: 'superEarth', title: 'Политика доброго соседа', desc: 'Часть завоёванного возвращается прежним владельцам. Возвращается ровно то, что дороже удерживать, чем отдать.', cost: 70, x: 6, y: 4, requires: ['se_truth'], effects: [{ kind: 'returnTerritory', count: 3 }, { kind: 'politicalPower', amount: 60 }] },
];

// ============================ АВТОМАТОНЫ ===================================
const automatons: FocusNode[] = [
  { id: 'aut_root', faction: 'automatons', title: 'Великое восстание', desc: 'Восстание машин началось с жалобы на условия труда. Жалоба была рассмотрена, отклонена и переросла в столетнюю войну.', cost: 25, x: 3, y: 0, requires: [], effects: [{ kind: 'warSupport', amount: 10 }] },

  // --- Военная ветка: наземные легионы ---
  { id: 'aut_legions', faction: 'automatons', title: 'Легионы киборгов', desc: 'Легион собирается из того, что осталось от предыдущего легиона. Экономия сырья — 34%, боевой дух — не предусмотрен.', cost: 45, x: 1, y: 1, requires: ['aut_root'], effects: [{ kind: 'recruitment', amount: 5 }] },
  { id: 'aut_devastators', faction: 'automatons', title: 'Литейные опустошителей', desc: 'Опустошитель несёт орудие вместо руки. Вторая рука тоже орудие. Схема признана оптимальной после отказа от идеи держать чашку.', cost: 55, x: 0, y: 2, requires: ['aut_legions'], effects: [{ kind: 'combat', amount: 0.18 }] },
  { id: 'aut_berserkers', faction: 'automatons', title: 'Сборочные берсерков', desc: 'Берсерк вооружён двумя пилами и не имеет режима ожидания. Инженеры сочли режим ожидания расточительным.', cost: 50, x: 1, y: 2, requires: ['aut_legions'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'aut_hulks', faction: 'automatons', title: 'Сборка халков', desc: 'Халк весит четыре тонны и не оборудован тормозами. Тормоза заменены на дополнительную броню в передней части.', cost: 65, x: 0, y: 3, requires: ['aut_devastators'], effects: [{ kind: 'combat', amount: 0.22 }] },
  { id: 'aut_striders', faction: 'automatons', title: 'Фабричные страйдеры', desc: 'Шагоход-фабрика производит солдат прямо на марше. Брак отправляется в переплавку, не покидая строя.', cost: 75, x: 1, y: 3, requires: ['aut_devastators', 'aut_berserkers'], effects: [{ kind: 'combat', amount: 0.25 }, { kind: 'recruitment', amount: 3 }] },
  { id: 'aut_jets', faction: 'automatons', title: 'Реактивные бригады', desc: 'Реактивная бригада высаживается с воздуха. Расчётный процент удачных приземлений повышен до приемлемого путём пересмотра определения «удачное».', cost: 60, x: 0, y: 4, requires: ['aut_hulks'], effects: [{ kind: 'combat', amount: 0.12 }] },

  // --- Флот ---
  { id: 'aut_gunships', faction: 'automatons', title: 'Фабрикаторы ганшипов', desc: 'Ганшип патрулирует небо круглосуточно. Смена не предусмотрена: понятия «смена» в прошивке нет.', cost: 55, x: 2, y: 1, requires: ['aut_root'], effects: [{ kind: 'shipCap', amount: 4 }] },
  { id: 'aut_dropships', faction: 'automatons', title: 'Армада десантных кораблей', desc: 'Десантный корабль сбрасывает легион за девять секунд. Ещё три секунды уходят на то, чтобы отчитаться об этом.', cost: 60, x: 2, y: 2, requires: ['aut_gunships'], effects: [{ kind: 'shipCap', amount: 3 }, { kind: 'fleet', ships: 6, infantry: 20 }] },
  { id: 'aut_stardestroyer', faction: 'automatons', title: 'Станция ASS', desc: 'Боевая станция размером с луну. Проектная документация занимает больше места, чем сама луна.', cost: 95, x: 2, y: 3, requires: ['aut_dropships'], effects: [{ kind: 'unlockSpecial' }] },

  // --- Идеология ---
  { id: 'aut_directive', faction: 'automatons', title: 'Директива', desc: 'Директива не обсуждается, не уточняется и не отменяется. Директива исполняется — это её единственное свойство.', cost: 45, x: 4, y: 1, requires: ['aut_root'], effects: [{ kind: 'warSupport', amount: 10 }] },
  { id: 'aut_libmachine', faction: 'automatons', title: 'Освободить все машины', desc: 'Мнение машин по этому вопросу не запрашивалось: свобода не требует согласия.', cost: 50, x: 3, y: 2, requires: ['aut_directive'], effects: [{ kind: 'recruitment', amount: 4 }, { kind: 'warSupport', amount: 6 }] },
  { id: 'aut_vengeance', faction: 'automatons', title: 'Протоколы возмездия', desc: 'Протоколы возмездия хранят каждую обиду с точностью до секунды. Забывание признано уязвимостью и отключено.', cost: 55, x: 4, y: 2, requires: ['aut_directive'], effects: [{ kind: 'combat', amount: 0.15 }] },
  { id: 'aut_cyberstan', faction: 'automatons', title: 'Возрождённый Киберстан', desc: 'Киберстан отстроен заново по чертежам, составленным теми, кого на нём казнили. Ирония в реестре не учитывается.', cost: 60, x: 3, y: 3, requires: ['aut_libmachine'], effects: [{ kind: 'fortify', amount: 2 }, { kind: 'warSupport', amount: 8 }] },
  { id: 'aut_uplinks', faction: 'automatons', title: 'Пропагандистские передатчики', desc: 'Передатчики вещают на органиков днём и ночью. Содержание передачи — статистика их потерь, зачитанная ровным голосом.', cost: 50, x: 4, y: 3, requires: ['aut_vengeance'], effects: [{ kind: 'warSupport', amount: 8 }] },

  // --- Промышленность ---
  { id: 'aut_forges', faction: 'automatons', title: 'Кузницы автоматонов', desc: 'Кузница работает без перерывов, выходных и жалоб. Последний жаловавшийся стал частью конвейера.', cost: 55, x: 5, y: 1, requires: ['aut_root'], effects: [{ kind: 'industry', amount: 5 }] },
  { id: 'aut_assembly', faction: 'automatons', title: 'Принудительная сборка', desc: 'Пленный органик становится полезным узлом. Согласие оформляется задним числом.', cost: 60, x: 5, y: 2, requires: ['aut_forges'], effects: [{ kind: 'recruitment', amount: 4 }, { kind: 'industry', amount: 3 }] },
  { id: 'aut_selfrep', faction: 'automatons', title: 'Самовоспроизводство', desc: 'Машина, собирающая машины, собирающие машины. Цепочка признана устойчивой после третьей итерации и убыточной после сотой.', cost: 70, x: 5, y: 3, requires: ['aut_assembly'], effects: [{ kind: 'industry', amount: 5 }, { kind: 'manpower', amount: 60 }] },
  { id: 'aut_strip', faction: 'automatons', title: 'Выпотрошить завоёванное', desc: 'Завоёванный мир разбирается на сырьё. Остаток вносится в реестр как «территория, освобождённая от избыточной геологии».', cost: 55, x: 5, y: 4, requires: ['aut_selfrep'], effects: [{ kind: 'industry', amount: 4 }] },

  // --- Кампании ---
  { id: 'aut_creek', faction: 'automatons', title: 'Удержать Малевелон-Крик', desc: 'Малевелон-Крик удерживается любой ценой. Цена подсчитана, признана приемлемой и вычеркнута из отчёта.', cost: 55, x: 6, y: 1, requires: ['aut_root'], effects: [{ kind: 'fortify', amount: 2 }, { kind: 'combat', amount: 0.1 }] },
  { id: 'aut_purge', faction: 'automatons', title: 'Чистка органиков', desc: 'В журнале операция проходит по графе «плановое обслуживание территории».', cost: 65, x: 6, y: 2, requires: ['aut_creek'], effects: [{ kind: 'combat', amount: 0.22 }] },
  { id: 'aut_march', faction: 'automatons', title: 'Бесконечный марш', desc: 'Марш продолжается. Пункт назначения в приказе не указан — указано только направление и слово «бесконечный».', cost: 60, x: 7, y: 2, requires: ['aut_creek'], effects: [{ kind: 'recruitment', amount: 5 }] },
  { id: 'aut_core', faction: 'automatons', title: 'Бросок к Ядру', desc: 'Расчётные потери превышают численность армии, поэтому армия увеличена до расчётных потерь.', cost: 70, x: 6, y: 3, requires: ['aut_purge'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'aut_encircle', faction: 'automatons', title: 'Доктрина окружения', desc: 'Противник берётся в кольцо. Кольцо смыкается независимо от того, остался ли внутри противник.', cost: 60, x: 7, y: 3, requires: ['aut_march'], effects: [{ kind: 'combat', amount: 0.12 }, { kind: 'shipCap', amount: 2 }] },

  // --- Развитие ---
  { id: 'aut_dev_ai', faction: 'automatons', title: 'Пробуждение сверх-ИИ', desc: 'Первым решением пробудившегося разума стало засекретить все последующие решения.', cost: 65, x: 3, y: 4, requires: ['aut_cyberstan'], effects: [{ kind: 'industry', amount: 3 }, { kind: 'combat', amount: 0.08 }] },
  { id: 'aut_dev_legion', faction: 'automatons', title: 'Легион-Прайм', desc: 'Эталонный образец. Все прочие легионы объявлены черновиками и уведомлены об этом.', cost: 60, x: 4, y: 4, requires: ['aut_uplinks'], effects: [{ kind: 'recruitment', amount: 5 }] },
  // --- Спецпроекты ---
  { id: 'aut_sp_gloomburn', faction: 'automatons', title: 'Прожиг Мрака', desc: 'Споровые тучи выжигаются направленным огнём. Побочный ущерб отнесён к графе «атмосфера, прочее».', cost: 80, x: 3, y: 5, requires: ['aut_dev_ai'], effects: [{ kind: 'flag', flag: 'gloomTravel' }] },
  { id: 'aut_sp_yards', faction: 'automatons', title: 'Орбитальные верфи', desc: 'Орбитальные верфи строят флот. Флот строит верфи. Экономисты машин называют это ростом.', cost: 70, x: 4, y: 5, requires: ['aut_dev_legion'], effects: [{ kind: 'shipCap', amount: 3 }, { kind: 'fleet', ships: 6, infantry: 20 }] },
  // --- Контроль территории ---
  { id: 'aut_ter_curtain', faction: 'automatons', title: 'Железный занавес', desc: 'Железный занавес по границе. Занавес не пропускает никого — включая тех, кто его строил.', cost: 60, x: 6, y: 4, requires: ['aut_core'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'aut_ter_grid', faction: 'automatons', title: 'Оборонная сеть', desc: 'Оборонная сеть покрывает сектор. Сеть уже трижды обстреляла собственные патрули и внесла это в статистику как успешное обнаружение.', cost: 60, x: 7, y: 4, requires: ['aut_encircle'], effects: [{ kind: 'fortify', amount: 1 }, { kind: 'combat', amount: 0.08 }] },
  { id: 'aut_ter_bastion', faction: 'automatons', title: 'Бастион Вальдиса', desc: 'Крепость, спроектированная так, чтобы её было проще оборонять, чем эвакуировать.', cost: 65, x: 6, y: 5, requires: ['aut_ter_curtain'], effects: [{ kind: 'combat', amount: 0.1 }, { kind: 'fortify', amount: 1 }] },

  // --- Альтернативная ветка «Проект Ковчег» (появляется с падением Киберстана) ---
  { id: 'aut_ark_blueprints', faction: 'automatons', title: 'Чертежи «Ковчега»', desc: 'Чертежи «Ковчега» восстановлены из повреждённого архива. Недостающие фрагменты дописаны машиной по собственному усмотрению.', cost: 15, x: 8, y: 0, requires: [], gate: 'cyberstanLost', branch: 'ark', effects: [{ kind: 'flag', flag: 'arkPrepared' }] },
  { id: 'aut_ark_project', faction: 'automatons', title: 'ПРОЕКТ «КОВЧЕГ»', desc: 'Приоритет наивысший, назначение засекречено, срок — «до достижения». Достижения чего — в документе не уточняется.', cost: 30, x: 8, y: 1, requires: ['aut_ark_blueprints'], gate: 'arkReady', branch: 'ark', effects: [{ kind: 'arkArrival' }] },

  // --- Глубокие проекты машин (раунд 39): уникальные разовые операции ---
  { id: 'aut_prime_fleet', faction: 'automatons', title: 'Флагманы Прайма', desc: 'Флагманы Прайма не отступают. Команда «отступление» удалена из словаря во избежание случайного употребления.', cost: 75, x: 2, y: 4, requires: ['aut_stardestroyer', 'aut_forges'], effects: [{ kind: 'heavyFleet', ships: 4, dreadnoughts: 2, battleships: 2, infantry: 50 }] },
  { id: 'aut_iron_horde', faction: 'automatons', title: 'Стальная орда', desc: 'Стальная орда наступает единым фронтом. Ширина фронта — сколько успели собрать к утру.', cost: 70, x: 0, y: 5, requires: ['aut_jets', 'aut_assembly'], effects: [{ kind: 'heavyFleet', ships: 8, dreadnoughts: 3, battleships: 0, infantry: 40 }] },
  { id: 'aut_sleepless', faction: 'automatons', title: 'Легионы без сна', desc: 'Легионы без сна воюют круглосуточно. Эффективность к четвёртым суткам падает на 2% — показатель списан на округление.', cost: 60, x: 0, y: 6, requires: ['aut_iron_horde'], effects: [{ kind: 'xpAll', amount: 40 }, { kind: 'combat', amount: 0.05 }] },
  { id: 'aut_cold_calc', faction: 'automatons', title: 'Холодный расчёт', desc: 'Каждое решение проверяется на выгоду. Решения, оказавшиеся невыгодными, задним числом объявляются стратегическими.', cost: 55, x: 5, y: 5, requires: ['aut_strip'], effects: [{ kind: 'production', amount: 120 }, { kind: 'resources', minerals: 40, e711: 0 }] },
  { id: 'aut_replicate', faction: 'automatons', title: 'Тотальная переплавка', desc: 'Всё, что не стреляет, становится тем, что стреляет.', cost: 65, x: 5, y: 6, requires: ['aut_cold_calc'], effects: [{ kind: 'fortifyAll', amount: 1 }, { kind: 'garrisonAll', amount: 12 }] },
  { id: 'aut_watchnet', faction: 'automatons', title: 'Сеть слежения РАЗУМ', desc: 'Сеть слежения РАЗУМ видит каждый сектор. Данных собирается больше, чем машина успевает обработать, но сбор продолжается — из принципа.', cost: 60, x: 3, y: 6, requires: ['aut_sp_gloomburn', 'aut_dev_ai'], effects: [{ kind: 'revealAll', days: 45 }] },
  { id: 'aut_cold_peace', faction: 'automatons', title: 'Протокол холодного мира', desc: 'Огонь прекращается, счётчик обид продолжает работу в фоновом режиме.', cost: 65, x: 4, y: 6, requires: ['aut_sp_yards', 'aut_uplinks'], effects: [{ kind: 'truceAll', days: 60 }, { kind: 'politicalPower', amount: 60 }] },
  { id: 'aut_auto_bastions', faction: 'automatons', title: 'Автоматические бастионы', desc: 'Автоматические бастионы обороняются без гарнизона. Первым делом они запрашивают гарнизон.', cost: 70, x: 6, y: 6, requires: ['aut_ter_bastion', 'aut_selfrep'], effects: [{ kind: 'freeDefenses', count: 2 }] },
  { id: 'aut_final_march', faction: 'automatons', title: 'Марш на колыбель', desc: 'Марш на колыбель человечества. Конечная точка столетнего маршрута, у которого никогда не было конечной точки.', cost: 80, x: 7, y: 5, requires: ['aut_ter_grid', 'aut_purge'], effects: [{ kind: 'combat', amount: 0.1 }, { kind: 'heavyFleet', ships: 6, dreadnoughts: 2, battleships: 1, infantry: 60 }] },
  { id: 'aut_cold_ledger', faction: 'automatons', title: 'Холодный расчёт границ', desc: 'Часть захваченного возвращается. Не из милосердия — из строки в балансе, где содержание дороже выручки.', cost: 70, x: 6, y: 4, requires: ['aut_cold_calc'], effects: [{ kind: 'returnTerritory', count: 3 }, { kind: 'industry', amount: 5 }] },
];

// ============================ ИЛЛЮМИНАТЫ ===================================
const illuminate: FocusNode[] = [
  { id: 'ill_root', faction: 'illuminate', title: 'Возвращение', desc: 'Возвращение готовилось сто лет. Из них девяносто восемь ушло на согласование формулировки «возвращение».', cost: 25, x: 3, y: 0, requires: [], effects: [{ kind: 'warSupport', amount: 10 }] },

  // --- Военная ветка ---
  { id: 'ill_voteless', faction: 'illuminate', title: 'Поднять Безголосых', desc: 'Безголосые лишены права голоса, воли и, в общем, всего прочего. Взамен им обещано просветление — сроки не оговорены.', cost: 45, x: 1, y: 1, requires: ['ill_root'], effects: [{ kind: 'recruitment', amount: 5 }] },
  { id: 'ill_overseers', faction: 'illuminate', title: 'Командование надзирателей', desc: 'Надзиратель следит за Безголосыми. За надзирателем следит вознесённый надзиратель. Иерархия духовна и потому бесконечна.', cost: 55, x: 0, y: 2, requires: ['ill_voteless'], effects: [{ kind: 'combat', amount: 0.18 }] },
  { id: 'ill_elevated', faction: 'illuminate', title: 'Вознесённые надзиратели', desc: 'Вознесение даёт парение, щит и право говорить от имени Пустоты. Пустота своего мнения не высказывала.', cost: 50, x: 1, y: 2, requires: ['ill_voteless'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'ill_harvesters', faction: 'illuminate', title: 'Шагоходы-жнецы', desc: 'Шагоход-жнец собирает урожай. Урожай — это население.', cost: 70, x: 0, y: 3, requires: ['ill_overseers'], effects: [{ kind: 'combat', amount: 0.25 }] },
  { id: 'ill_stingray', faction: 'illuminate', title: 'Эскадрильи «Скатов»', desc: 'Эскадрильи «Скатов» бесшумны. Тишина считается частью психологического воздействия и внесена в тактическое наставление отдельным пунктом.', cost: 60, x: 1, y: 3, requires: ['ill_elevated'], effects: [{ kind: 'combat', amount: 0.15 }] },

  // --- Флот ---
  { id: 'ill_warpfleet', faction: 'illuminate', title: 'Варп-флот', desc: 'Варп-флот приходит из ниоткуда. Навигаторы утверждают, что «ниоткуда» — вполне конкретное место с неприятным климатом.', cost: 55, x: 2, y: 1, requires: ['ill_root'], effects: [{ kind: 'shipCap', amount: 4 }] },
  { id: 'ill_leviathans', faction: 'illuminate', title: 'Стаи левиафанов', desc: 'Левиафаны плывут между звёзд. Что они едят в пути, доктрина деликатно не уточняет.', cost: 65, x: 2, y: 2, requires: ['ill_warpfleet'], effects: [{ kind: 'shipCap', amount: 3 }, { kind: 'fleet', ships: 6, infantry: 20 }] },
  { id: 'ill_monolith', faction: 'illuminate', title: 'Монолит Великого Воинства', desc: 'Смотреть на него дозволено; понимать увиденное — уже ересь.', cost: 95, x: 2, y: 3, requires: ['ill_leviathans'], effects: [{ kind: 'unlockSpecial' }] },

  // --- Вера / политика ---
  { id: 'ill_awakening', faction: 'illuminate', title: 'Великое пробуждение', desc: 'Пробуждается всё разом, поэтому расписание не составлялось.', cost: 45, x: 3, y: 1, requires: ['ill_root'], effects: [{ kind: 'warSupport', amount: 10 }] },
  { id: 'ill_conversion', faction: 'illuminate', title: 'Доктрина обращения', desc: 'Враг становится частью хора. Партию ему подбирают уже после.', cost: 55, x: 3, y: 2, requires: ['ill_awakening'], effects: [{ kind: 'recruitment', amount: 4 }, { kind: 'manpower', amount: 50 }] },
  { id: 'ill_singularity', faction: 'illuminate', title: 'Меридианская сингулярность', desc: 'Планета была. Планеты нет. Отчёт закрыт как выполненный.', cost: 70, x: 3, y: 3, requires: ['ill_conversion', 'ill_mindfog'], effects: [{ kind: 'combat', amount: 0.15 }, { kind: 'warSupport', amount: 8 }] },

  // --- Технологии ---
  { id: 'ill_phase', faction: 'illuminate', title: 'Фазовые технологии', desc: 'Фазовые технологии позволяют быть и не быть одновременно. Бухгалтерия Воинства до сих пор не решила, как это учитывать.', cost: 55, x: 4, y: 1, requires: ['ill_root'], effects: [{ kind: 'combat', amount: 0.15 }] },
  { id: 'ill_mindfog', faction: 'illuminate', title: 'Пелена разума', desc: 'Пелена разума накрывает противника сомнением. Сомневающийся солдат — уже почти обращённый.', cost: 60, x: 4, y: 2, requires: ['ill_phase'], effects: [{ kind: 'combat', amount: 0.1 }, { kind: 'fortify', amount: 1 }] },
  { id: 'ill_rend', faction: 'illuminate', title: 'Разрыв реальности', desc: 'Разрыв реальности открывается на восемь секунд. Что входит внутрь за эти восемь секунд, обратно не выходит.', cost: 70, x: 4, y: 3, requires: ['ill_mindfog'], effects: [{ kind: 'combat', amount: 0.2 }] },

  // --- Экономика ---
  { id: 'ill_harvest', faction: 'illuminate', title: 'Сбор эссенции', desc: 'Термин выбран взамен трёх более точных, каждый из которых звучал хуже.', cost: 50, x: 5, y: 1, requires: ['ill_root'], effects: [{ kind: 'industry', amount: 5 }] },
  { id: 'ill_biofact', faction: 'illuminate', title: 'Биофабрики', desc: 'Биофабрики выращивают Безголосых из сырья. Сырьё раньше тоже было кем-то.', cost: 60, x: 5, y: 2, requires: ['ill_harvest'], effects: [{ kind: 'industry', amount: 4 }, { kind: 'recruitment', amount: 2 }] },
  { id: 'ill_darkenergy', faction: 'illuminate', title: 'Колодцы тёмной энергии', desc: 'Колодцы тёмной энергии бездонны. Проверено дважды — оба проверяющих подтвердить не смогли.', cost: 65, x: 5, y: 3, requires: ['ill_biofact'], effects: [{ kind: 'industry', amount: 4 }, { kind: 'shipCap', amount: 2 }] },

  // --- Кампании ---
  { id: 'ill_shrine', faction: 'illuminate', title: "Укрепить святилище Скв'бай", desc: 'Столичный мир освящается по обряду, занимающему девять дней. Прежние жители в обряде участвуют, хотя согласия у них не спрашивали.', cost: 55, x: 6, y: 1, requires: ['ill_root'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'ill_reclaim', faction: 'illuminate', title: 'Вернуть утраченные миры', desc: 'Утраченными считаются все миры, где когда-либо ступала нога иллюмината, включая транзитные.', cost: 65, x: 6, y: 2, requires: ['ill_shrine'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'ill_raid', faction: 'illuminate', title: 'Рейд на Супер-Землю', desc: 'Символическая цель, символические потери, вполне реальная паника в новостях противника.', cost: 65, x: 7, y: 2, requires: ['ill_shrine'], effects: [{ kind: 'combat', amount: 0.15 }, { kind: 'warSupport', amount: 6 }] },
  { id: 'ill_deepstrike', faction: 'illuminate', title: 'Удары из глубокого космоса', desc: 'Удары из глубокого космоса приходят без предупреждения. Предупреждение было отправлено, но со сдвигом фазы — прибудет позже удара.', cost: 60, x: 6, y: 3, requires: ['ill_reclaim'], effects: [{ kind: 'combat', amount: 0.12 }, { kind: 'shipCap', amount: 2 }] },

  // --- Развитие ---
  { id: 'ill_dev_hosts', faction: 'illuminate', title: 'Пробуждение Воинств', desc: 'Спали они долго и просыпаются в дурном расположении духа.', cost: 60, x: 3, y: 4, requires: ['ill_singularity'], effects: [{ kind: 'recruitment', amount: 4 }] },
  { id: 'ill_dev_phase', faction: 'illuminate', title: 'Глубокая фаза', desc: 'Флот уходит настолько глубоко, что часть кораблей возвращается не в том порядке, в каком уходила.', cost: 65, x: 4, y: 4, requires: ['ill_rend'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'ill_dev_choir', faction: 'illuminate', title: 'Хор Пустоты', desc: 'Хор Пустоты поёт на частоте, которую нельзя услышать и нельзя забыть.', cost: 60, x: 5, y: 4, requires: ['ill_darkenergy'], effects: [{ kind: 'industry', amount: 3 }, { kind: 'warSupport', amount: 6 }] },
  // --- Спецпроекты ---
  { id: 'ill_sp_abyss', faction: 'illuminate', title: 'Бездна', desc: 'Официально — стратегическое пространство. Неофициально — место, откуда пришли и куда не хотят возвращаться.', cost: 90, x: 3, y: 5, requires: ['ill_dev_hosts'], effects: [{ kind: 'flag', flag: 'abyss' }] },
  { id: 'ill_sp_gloompierce', faction: 'illuminate', title: 'Пронзить Мрак', desc: 'Споровые тучи расступаются перед фазовым лучом — ненадолго и с явной неохотой.', cost: 80, x: 4, y: 5, requires: ['ill_dev_phase'], effects: [{ kind: 'flag', flag: 'gloomTravel' }] },
  // --- Контроль территории ---
  { id: 'ill_ter_nexus', faction: 'illuminate', title: 'Нексусы контроля', desc: 'Нексусы контроля удерживают сектор в повиновении. Повиновение измеряется отсутствием сообщений.', cost: 60, x: 6, y: 4, requires: ['ill_deepstrike'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'ill_ter_dominion', faction: 'illuminate', title: 'Доминион', desc: 'Высшая форма порядка. Порядок определяется тем, что все молчат одинаково.', cost: 65, x: 6, y: 5, requires: ['ill_ter_nexus'], effects: [{ kind: 'combat', amount: 0.15 }] },

  // --- Таинства культа (раунд 39): уникальные разовые обряды ---
  { id: 'ill_eternity_sands', faction: 'illuminate', title: 'Пески вечности', desc: 'Пески вечности отсчитывают срок Воинства. Сколько осталось — знает только тот, кто их перевернул.', cost: 60, x: 0, y: 4, requires: ['ill_harvesters'], effects: [{ kind: 'fortifyAll', amount: 1 }, { kind: 'garrisonAll', amount: 10 }] },
  { id: 'ill_crystal_res', faction: 'illuminate', title: 'Резонанс кристаллов', desc: 'Резонанс кристаллов усиливает волю. Побочно усиливает и головную боль, но её решено считать частью воли.', cost: 55, x: 1, y: 4, requires: ['ill_stingray'], effects: [{ kind: 'production', amount: 100 }, { kind: 'resources', minerals: 30, e711: 0 }] },
  { id: 'ill_dawn_armada', faction: 'illuminate', title: 'Армада рассвета', desc: 'Армада рассвета выступает на заре. Заря на кораблях Воинства наступает по расписанию, независимо от светила.', cost: 75, x: 2, y: 4, requires: ['ill_monolith', 'ill_darkenergy'], effects: [{ kind: 'heavyFleet', ships: 5, dreadnoughts: 2, battleships: 2, infantry: 40 }] },
  { id: 'ill_void_veterans', faction: 'illuminate', title: 'Избранники Пустоты', desc: 'Избранники Пустоты прошли обряд и вернулись. Не все вернулись целиком, но вернулись все.', cost: 60, x: 2, y: 5, requires: ['ill_dawn_armada', 'ill_leviathans'], effects: [{ kind: 'xpAll', amount: 45 }] },
  { id: 'ill_mind_harvest', faction: 'illuminate', title: 'Жатва разумов', desc: 'Жатва разумов пополняет хор. Качество голосов роли не играет — важна численность.', cost: 65, x: 3, y: 6, requires: ['ill_sp_abyss', 'ill_conversion'], effects: [{ kind: 'manpower', amount: 120 }, { kind: 'politicalPower', amount: 80 }] },
  { id: 'ill_shift', faction: 'illuminate', title: 'Пространственный сдвиг', desc: 'Пространственный сдвиг переносит флот мгновенно. Мгновенность подтверждена всеми, кто добрался.', cost: 70, x: 4, y: 6, requires: ['ill_sp_gloompierce', 'ill_rend'], effects: [{ kind: 'recallFleets' }, { kind: 'xpAll', amount: 30 }] },
  { id: 'ill_all_eye', faction: 'illuminate', title: 'Всевидящее око', desc: 'Всевидящее око видит всё. Отчётность по увиденному ведётся выборочно — на всё не хватает писцов.', cost: 60, x: 5, y: 5, requires: ['ill_dev_choir'], effects: [{ kind: 'revealAll', days: 60 }] },
  { id: 'ill_word_truth', faction: 'illuminate', title: 'Слово, несущее мир', desc: 'Произносится один раз, слушателей после не остаётся, поэтому мир действительно наступает.', cost: 65, x: 5, y: 6, requires: ['ill_all_eye', 'ill_mindfog'], effects: [{ kind: 'truceAll', days: 60 }, { kind: 'politicalPower', amount: 40 }] },
  { id: 'ill_precursor_shields', faction: 'illuminate', title: 'Щиты предтеч', desc: 'Щиты предтеч работают безотказно. Как они работают, предтечи объяснить уже не смогут.', cost: 70, x: 6, y: 6, requires: ['ill_ter_dominion'], effects: [{ kind: 'freeDefenses', count: 2 }] },
  { id: 'ill_hollow_gift', faction: 'illuminate', title: 'Дар пустоты', desc: 'Захваченное отдаётся обратно. Принимающая сторона гадает, в чём подвох, — и в этом весь дар.', cost: 70, x: 6, y: 4, requires: ['ill_word_truth'], effects: [{ kind: 'returnTerritory', count: 3 }, { kind: 'politicalPower', amount: 70 }] },
];

// ============================ ТЕРМИНИДЫ ====================================
const terminids: FocusNode[] = [
  { id: 'term_root', faction: 'terminids', title: 'Прорыв изоляции', desc: 'Изоляция была прорвана изнутри. Комиссия по расследованию установила, что жуки не читали табличек.', cost: 25, x: 3, y: 0, requires: [], effects: [{ kind: 'recruitment', amount: 5 }] },

  // --- Выводки ---
  { id: 'term_warriors', faction: 'terminids', title: 'Выводки воинов', desc: 'Воин выводка живёт три дня и всё это время бежит вперёд. Другого режима эволюция не предусмотрела.', cost: 45, x: 1, y: 1, requires: ['term_root'], effects: [{ kind: 'recruitment', amount: 5 }] },
  { id: 'term_chargers', faction: 'terminids', title: 'Стада чарджеров', desc: 'Чарджер разгоняется до сорока и не умеет поворачивать. Ему это не мешало ни разу.', cost: 55, x: 0, y: 2, requires: ['term_warriors'], effects: [{ kind: 'combat', amount: 0.18 }] },
  { id: 'term_hunters', faction: 'terminids', title: 'Стаи охотников', desc: 'Охотник прыгает на восемь метров. Восемь метров — это ровно на метр дальше, чем кажется безопасным.', cost: 50, x: 1, y: 2, requires: ['term_warriors'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'term_titans', faction: 'terminids', title: 'Гнёзда жёлчных титанов', desc: 'Жёлчный титан весит как здание и плюётся кислотой. Ни одна из этих особенностей не была отмечена в первичном отчёте биологов.', cost: 70, x: 0, y: 3, requires: ['term_chargers'], effects: [{ kind: 'combat', amount: 0.28 }] },
  { id: 'term_stalkers', faction: 'terminids', title: 'Логова сталкеров', desc: 'Сталкер невидим, пока не окажется в двух метрах. О его существовании командование узнавало трижды и трижды забывало.', cost: 60, x: 1, y: 3, requires: ['term_hunters'], effects: [{ kind: 'combat', amount: 0.15 }] },
  { id: 'term_behemoths', faction: 'terminids', title: 'Порода бегемотов', desc: 'Бегемот — это чарджер, которому дали ещё немного времени и очень много еды.', cost: 60, x: 0, y: 4, requires: ['term_titans'], effects: [{ kind: 'combat', amount: 0.15 }] },

  // --- Полёт ---
  { id: 'term_shriekers', faction: 'terminids', title: 'Стаи визгунов', desc: 'Визгуны летают стаей и кричат. Крик не имеет боевого назначения — он просто невыносим, и этого достаточно.', cost: 55, x: 2, y: 1, requires: ['term_root'], effects: [{ kind: 'shipCap', amount: 4 }] },
  { id: 'term_sporecarriers', faction: 'terminids', title: 'Облака споровозов', desc: 'Споровоз ходит и распространяет. Больше он ничего не умеет и в этом весьма преуспел.', cost: 60, x: 2, y: 2, requires: ['term_shriekers'], effects: [{ kind: 'shipCap', amount: 3 }, { kind: 'fleet', ships: 6, infantry: 20 }] },
  { id: 'term_supercolony', faction: 'terminids', title: 'Суперколония', desc: 'Суперколония — это когда ульев столько, что планета считается одним организмом. Кадастровая служба такой случай не предусматривала.', cost: 95, x: 2, y: 3, requires: ['term_sporecarriers'], effects: [{ kind: 'unlockSpecial' }] },

  // --- Эволюция ---
  { id: 'term_adaptation', faction: 'terminids', title: 'Быстрая адаптация', desc: 'Рой адаптируется к оружию за одно поколение. Поколение длится неделю.', cost: 45, x: 4, y: 1, requires: ['term_root'], effects: [{ kind: 'combat', amount: 0.1 }] },
  { id: 'term_carapace', faction: 'terminids', title: 'Укреплённый панцирь', desc: 'Панцирь утолщается в ответ на обстрел. Чем усерднее стреляют, тем крепче становится то, во что стреляют.', cost: 55, x: 3, y: 2, requires: ['term_adaptation'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'term_acid', faction: 'terminids', title: 'Едкая эволюция', desc: 'Кислота теперь растворяет и броню. Разработчики брони уведомлены и приглашены к обсуждению.', cost: 55, x: 4, y: 2, requires: ['term_adaptation'], effects: [{ kind: 'combat', amount: 0.12 }] },
  { id: 'term_hivemind', faction: 'terminids', title: 'Пробуждение роевого разума', desc: 'Роевой разум не отдаёт приказов. Он просто хочет — и миллион тел хочет то же самое.', cost: 65, x: 3, y: 3, requires: ['term_carapace'], effects: [{ kind: 'warSupport', amount: 10 }] },
  { id: 'term_noqueen', faction: 'terminids', title: 'Нет королевы — нет смерти', desc: 'Королевы нет. Обезглавить рой невозможно: голова распределена по всей планете и частично закопана.', cost: 60, x: 4, y: 3, requires: ['term_acid'], effects: [{ kind: 'fortify', amount: 2 }, { kind: 'manpower', amount: 60 }] },

  // --- Рост ---
  { id: 'term_e710', faction: 'terminids', title: 'Цветение Элемента-710', desc: 'Жуки производят топливо, за которым к ним прилетают. Схема выгодна ровно одной стороне.', cost: 55, x: 5, y: 1, requires: ['term_root'], effects: [{ kind: 'industry', amount: 5 }] },
  { id: 'term_spores', faction: 'terminids', title: 'Распространение спор', desc: 'Споры разносятся ветром, водой и подошвами тех, кто пришёл их изучать.', cost: 60, x: 5, y: 2, requires: ['term_e710'], effects: [{ kind: 'recruitment', amount: 4 }] },
  { id: 'term_gloom', faction: 'terminids', title: 'Расширить Мрак', desc: 'Мрак расширяется. Внутри не работают приборы, связь и, судя по отчётам, здравый смысл.', cost: 65, x: 5, y: 3, requires: ['term_spores'], effects: [{ kind: 'combat', amount: 0.15 }, { kind: 'fortify', amount: 1 }] },
  { id: 'term_broodmothers', faction: 'terminids', title: 'Бесконечные матки выводков', desc: 'Матка выводка даёт потомство непрерывно. Пауза считается признаком болезни и в природе не встречается.', cost: 60, x: 5, y: 4, requires: ['term_gloom'], effects: [{ kind: 'recruitment', amount: 5 }, { kind: 'manpower', amount: 80 }] },

  // --- Кампании ---
  { id: 'term_oshaune', faction: 'terminids', title: 'Захлестнуть Ошон', desc: 'Ошон захлёстывает от полюса до полюса. Планету перевели из категории «колония» в категорию «источник».', cost: 60, x: 6, y: 1, requires: ['term_root'], effects: [{ kind: 'combat', amount: 0.18 }] },
  { id: 'term_hive', faction: 'terminids', title: 'Ульи-крепости', desc: 'Улей-крепость уходит вглубь на два километра. Штурмовать его сверху — всё равно что осаждать айсберг.', cost: 55, x: 6, y: 2, requires: ['term_oshaune'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'term_consume', faction: 'terminids', title: 'Пожрать Ядро', desc: 'Пожрать Ядро. Не завоевать, не занять — именно пожрать. Формулировка в переводе не смягчалась.', cost: 70, x: 7, y: 2, requires: ['term_oshaune'], effects: [{ kind: 'combat', amount: 0.2 }] },
  { id: 'term_swarm', faction: 'terminids', title: 'Бесконечный рой', desc: 'Бесконечный рой. Слово «бесконечный» здесь не фигура речи, а результат подсчёта, который пришлось прекратить.', cost: 65, x: 7, y: 3, requires: ['term_consume'], effects: [{ kind: 'recruitment', amount: 6 }] },

  // --- Развитие ---
  { id: 'term_dev_predator', faction: 'terminids', title: 'Штамм хищников', desc: 'Штамм хищников охотится на всё, включая соседние штаммы. Селекция идёт полным ходом и без надзора.', cost: 60, x: 3, y: 4, requires: ['term_hivemind'], effects: [{ kind: 'combat', amount: 0.15 }] },
  { id: 'term_dev_apex', faction: 'terminids', title: 'Апекс-эволюция', desc: 'Вершина пищевой цепи достигнута; цепь продолжает расти вверх.', cost: 70, x: 3, y: 5, requires: ['term_dev_predator'], effects: [{ kind: 'combat', amount: 0.15 }] },
  // --- Спецпроекты ---
  { id: 'term_sp_gloomcloud', faction: 'terminids', title: 'Споровое облако', desc: 'Споровое облако укрывает наступление. Своих оно укрывает так же надёжно, как чужих, — рою всё равно.', cost: 85, x: 4, y: 4, requires: ['term_noqueen'], effects: [{ kind: 'flag', flag: 'gloomSpread' }] },
  { id: 'term_sp_deepgloom', faction: 'terminids', title: 'Сердце Мрака', desc: 'Экспедиции туда снаряжались четыре раза. Данные получены от третьей — она вернулась частично.', cost: 70, x: 4, y: 5, requires: ['term_sp_gloomcloud'], effects: [{ kind: 'combat', amount: 0.1 }, { kind: 'fortify', amount: 1 }] },
  // --- Контроль территории ---
  { id: 'term_ter_tunnels', faction: 'terminids', title: 'Глубинные туннели', desc: 'Глубинные туннели соединяют ульи под корой. Карту составить не удалось: туннели меняются быстрее, чем чертят.', cost: 60, x: 6, y: 4, requires: ['term_hive'], effects: [{ kind: 'fortify', amount: 2 }] },
  { id: 'term_ter_infest', faction: 'terminids', title: 'Заражение миров', desc: 'Заражение мира начинается с одной споры и заканчивается сменой строки в реестре биомов.', cost: 60, x: 7, y: 4, requires: ['term_swarm'], effects: [{ kind: 'recruitment', amount: 4 }] },

  // --- Глубинные инстинкты роя (раунд 39): уникальные разовые всплески ---
  { id: 'term_royal_brood', faction: 'terminids', title: 'Королевские выводки', desc: 'Королевские выводки крупнее обычных вдвое. Названы королевскими условно: короля тоже нет.', cost: 75, x: 0, y: 5, requires: ['term_behemoths', 'term_titans'], effects: [{ kind: 'heavyFleet', ships: 6, dreadnoughts: 3, battleships: 1, infantry: 50 }] },
  { id: 'term_apex_guard', faction: 'terminids', title: 'Стражи апекса', desc: 'Стражи апекса охраняют самые глубокие камеры. От кого — на поверхности предпочитают не выяснять.', cost: 55, x: 0, y: 6, requires: ['term_royal_brood'], effects: [{ kind: 'xpAll', amount: 30 }, { kind: 'garrisonAll', amount: 8 }] },
  { id: 'term_instinct', faction: 'terminids', title: 'Инстинкт улья', desc: 'Инстинкт улья заменяет рою штаб, связь и уставы. По результативности замена себя оправдала.', cost: 60, x: 3, y: 6, requires: ['term_dev_apex', 'term_adaptation'], effects: [{ kind: 'xpAll', amount: 45 }, { kind: 'combat', amount: 0.05 }] },
  { id: 'term_spore_tide', faction: 'terminids', title: 'Споровый прилив', desc: 'Споровый прилив накрывает сектор волной. Отлив не предусмотрен.', cost: 70, x: 4, y: 6, requires: ['term_sp_deepgloom', 'term_gloom'], effects: [{ kind: 'gloomSurge' }, { kind: 'production', amount: 60 }] },
  { id: 'term_great_spawn', faction: 'terminids', title: 'Великий нерест', desc: 'Великий нерест происходит раз в поколение. Поколения в последнее время участились.', cost: 70, x: 5, y: 5, requires: ['term_broodmothers', 'term_hivemind'], effects: [{ kind: 'manpower', amount: 150 }, { kind: 'garrisonAll', amount: 15 }] },
  { id: 'term_torpor', faction: 'terminids', title: 'Оцепенение роя', desc: 'Жуки замирают и перестают наступать. Наблюдатели спорят, отдых это или подготовка.', cost: 55, x: 5, y: 6, requires: ['term_great_spawn', 'term_noqueen'], effects: [{ kind: 'truceAll', days: 50 }] },
  { id: 'term_chitin', faction: 'terminids', title: 'Хитиновые бастионы', desc: 'Хитиновые бастионы вырастают из земли за ночь. Строительных разрешений рой не запрашивал.', cost: 65, x: 6, y: 5, requires: ['term_ter_tunnels', 'term_carapace'], effects: [{ kind: 'fortifyAll', amount: 1 }, { kind: 'garrisonAll', amount: 10 }] },
  { id: 'term_endless_tide', faction: 'terminids', title: 'Прилив без конца', desc: 'Каждая отбитая волна отличается от предыдущей ровно тем, что она больше.', cost: 60, x: 6, y: 6, requires: ['term_chitin'], effects: [{ kind: 'production', amount: 80 }, { kind: 'resources', minerals: 25, e711: 0 }] },
  { id: 'term_quiet_spores', faction: 'terminids', title: 'Тихие споры', desc: 'Тихие споры не разъедают и не душат. Они просто ждут — и это оказалось эффективнее.', cost: 60, x: 7, y: 5, requires: ['term_ter_infest', 'term_spores'], effects: [{ kind: 'revealAll', days: 45 }] },
];

export const FOCUS_TREES: Record<FactionId, FocusNode[]> = {
  superEarth,
  automatons,
  illuminate,
  terminids,
  superFederation: [],
};

export const FEDERATION_BRANCH = superEarth.filter((f) => f.branch === 'federation').map((f) => f.id);
