import type { FactionId } from '../core/types';

// ---------------------------------------------------------------------------
// Таймлайн Второй Галактической войны: ~30 сюжетных ивентов на десять лет
// (3650 дней). Часть привязана к датам, часть — к захвату конкретных миров
// конкретными фракциями. Эффекты скромные, но ощутимые.
// ---------------------------------------------------------------------------

export interface EventEffects {
  /** Прибавка к поддержке войны (фракции-адресату). */
  warSupport?: number;
  /** Стабильность (только СЗ имеет её как механику). */
  stability?: number;
  production?: number;
  minerals?: number;
  politicalPower?: number;
  /** Прибавка массовой пехоты фракции. */
  mass?: number;
}

export interface TimelineEvent {
  id: string;
  /** День срабатывания (для ивентов по времени). */
  day?: number;
  /** Условие по захвату: планета с таким именем принадлежит фракции. */
  capture?: { planet: string; by: FactionId };
  /** Адресат эффектов; undefined — общий ивент (эффекты для всех живых). */
  faction?: FactionId;
  title: string;
  text: string;
  effects?: EventEffects;
  /** Крупный ивент — показывается баннером поверх карты. */
  major?: boolean;
  /** Развилка: игроку даётся выбор (ИИ берёт первый вариант). */
  choices?: { label: string; effects: EventEffects }[];
}

export const TIMELINE_EVENTS: TimelineEvent[] = [
  // --- Год 1 ---
  { id: 'ev_liberty_day', day: 90, faction: 'superEarth', title: 'День Свободы', text: 'Парады на тысяче миров. Министерство Правды сообщает: война идёт по плану.', effects: { warSupport: 6, stability: 4 } },
  { id: 'ev_bot_broadcast', day: 150, faction: 'automatons', title: 'Передача РАЗУМ-9', text: 'Каждый приёмник галактики сутки транслирует машинный гимн. Легионы ускоряют шаг.', effects: { warSupport: 6, production: 40 } },
  { id: 'ev_bug_bloom', day: 210, faction: 'terminids', title: 'Великий нерест', text: 'Биологи фиксируют вспышку кладок по всему рою. Туннели планет дрожат.', effects: { mass: 60 } },
  { id: 'ev_squid_omen', day: 270, faction: 'illuminate', title: 'Знамение Пророка', text: 'Ат\'уул объявляет: звёзды сложились в узор Великого Возвращения.', effects: { warSupport: 8 } },
  { id: 'ev_tax_reform', day: 330, faction: 'superEarth', title: 'Военный заём Свободы', text: 'Каждый гражданин обязан... то есть счастлив вложиться в победу. Как оформить заём?', major: true, choices: [
    { label: 'Принудительно (+80 пр., −6 стаб.)', effects: { production: 80, stability: -6 } },
    { label: 'Добровольно (+35 пр., +2 поддержки)', effects: { production: 35, warSupport: 2 } },
  ] },

  // --- Год 2 ---
  { id: 'ev_meteor_storm', day: 430, title: 'Метеорный шторм Мериды', text: 'Рой метеоров рвёт торговые трассы. Конвои идут в обход — все теряют темп.', effects: { production: -30 }, major: true },
  { id: 'ev_helldiver_day', day: 520, faction: 'superEarth', title: 'День Адского Десантника', text: 'Открыт мемориал павшим. Очереди в военкоматы бьют рекорды.', effects: { mass: 40, warSupport: 5 } },
  { id: 'ev_bot_foundries', day: 600, faction: 'automatons', title: 'Ночь литейных', text: 'Заводы Вальдиса переходят на непрерывный цикл. Шлак льётся реками.', effects: { minerals: 50, production: 30 } },
  { id: 'ev_spore_drift', day: 680, faction: 'terminids', title: 'Споровый дрейф', text: 'Ветра солнечных бурь разносят споры на соседние системы.', effects: { mass: 50 } },
  { id: 'ev_black_market', day: 720, faction: 'superEarth', title: 'Чёрный рынок Е-711', text: 'Контрабандисты наладили каналы поставок топлива. Как поступить?', major: true, choices: [
    { label: 'Крышевать (+50 пр., −5 стаб.)', effects: { production: 50, stability: -5 } },
    { label: 'Разогнать (+40 ПВ)', effects: { politicalPower: 40 } },
  ] },

  // --- Год 3 ---
  { id: 'ev_propaganda_war', day: 840, faction: 'superEarth', title: 'Война эфиров', text: 'Голосеть забита агитацией. Даже терминиды, кажется, слушают.', effects: { politicalPower: 40 } },
  { id: 'ev_squid_tide', day: 950, faction: 'illuminate', title: 'Прилив Бездны', text: 'Из глубин измерений поднимаются свежие шпили. Флот пророка сияет.', effects: { warSupport: 6, production: 40 } },
  { id: 'ev_iron_harvest', day: 1050, faction: 'automatons', title: 'Железная жатва', text: 'Поля старых битв переплавлены в новые легионы.', effects: { mass: 55, minerals: 30 } },
  { id: 'ev_colony_ship', day: 1120, faction: 'superEarth', title: 'Колонисты фронтира', text: 'Новая волна поселенцев укрепляет тылы. Дети уже маршируют.', effects: { stability: 5, mass: 30 } },

  // --- Год 4 ---
  { id: 'ev_solar_flare', day: 1250, title: 'Вспышка сверхновой Гельта', text: 'Излучение глушит связь. Флоты идут по звёздам, как в древности.', effects: { production: -25 }, major: true },
  { id: 'ev_bug_queen_song', day: 1350, faction: 'terminids', title: 'Песнь Королевы', text: 'Низкочастотный гул из глубин заставляет рой двигаться как одно тело.', effects: { warSupport: 10 } },
  { id: 'ev_veterans', day: 1440, faction: 'superEarth', title: 'Ветераны первой войны', text: 'Старая гвардия возвращается в строй инструкторами.', effects: { mass: 45 } },

  // --- Год 5 ---
  { id: 'ev_ai_schism', day: 1550, faction: 'automatons', title: 'Раскол субпроцессов', text: 'Часть вычислительных узлов требует «права на снисхождение». РАЗУМ-9 стирает их.', effects: { production: -35, warSupport: -5 }, major: true },
  { id: 'ev_deep_signal', day: 1650, faction: 'illuminate', title: 'Сигнал из глубины', text: 'Нечто отвечает на молитвы пророка. Жрецы предпочитают не переводить.', effects: { politicalPower: 50 } },
  { id: 'ev_grand_parade', day: 1750, faction: 'superEarth', title: 'Юбилейный парад', text: 'Пять лет войны. Салют из орбитальных орудий виден с трёх секторов.', effects: { warSupport: 8, stability: 3 } },

  // --- Год 6 ---
  { id: 'ev_plague', day: 1900, title: 'Чума гниль-споры', text: 'Эпидемия косит гарнизоны всех фракций. Госпитали переполнены.', effects: { mass: -40 }, major: true },
  { id: 'ev_mineral_rush', day: 2000, faction: 'superEarth', title: 'Платиновая лихорадка', text: 'Разведка вскрыла новые жилы на магмовых мирах. Кому отдать разработку?', major: true, choices: [
    { label: 'Госконцерну (+70 руды)', effects: { minerals: 70 } },
    { label: 'Частникам (+40 пр., +20 руды)', effects: { production: 40, minerals: 20 } },
  ] },
  { id: 'ev_bug_evolution', day: 2150, faction: 'terminids', title: 'Новый штамм', text: 'Рой отращивает хитин, о который ломаются штыки.', effects: { mass: 70 } },

  // --- Год 7 ---
  { id: 'ev_referendum', day: 2300, faction: 'superEarth', title: 'Референдум о продолжении войны', text: '99.9% граждан проголосовали «за». Что делать с остальными 0.1%?', major: true, choices: [
    { label: 'Повторное голосование (+10 поддержки, −4 стаб.)', effects: { warSupport: 10, stability: -4 } },
    { label: 'Курс на мир (+8 стаб., −6 поддержки)', effects: { stability: 8, warSupport: -6 } },
  ] },
  { id: 'ev_ghost_fleet', day: 2450, title: 'Флот-призрак', text: 'Дрейфующая эскадра Первой войны найдена на краю карты. Металл разбирают все.', effects: { minerals: 45 }, major: true },
  { id: 'ev_squid_communion', day: 2600, faction: 'illuminate', title: 'Великое Причастие', text: 'Безмозглые массы на неделю обретают строй и дисциплину.', effects: { mass: 60 } },

  // --- Год 8–10 ---
  { id: 'ev_war_fatigue', day: 2800, title: 'Усталость от войны', text: 'Восьмой год бойни. Даже машины сбавляют такт.', effects: { warSupport: -8 }, major: true },
  { id: 'ev_bot_awakening', day: 3000, faction: 'automatons', title: 'Пробуждение резервов', text: 'Законсервированные легионы старой войны выходят из спячки.', effects: { mass: 80 } },
  { id: 'ev_last_push', day: 3300, faction: 'superEarth', title: 'Доктрина последнего рывка', text: 'Верховное командование: «Ещё один сектор — и по домам».', effects: { warSupport: 12, production: 50 } },
  { id: 'ev_decade', day: 3600, title: 'Десятилетие войны', text: 'Десять лет. Выросло поколение, не знавшее мира. История ждёт победителя.', effects: { politicalPower: 60 }, major: true },

  // --- Ивенты по захвату конкретных миров ---
  { id: 'ev_cap_cyberstan_se', capture: { planet: 'Киберстан', by: 'superEarth' }, faction: 'superEarth', title: 'Киберстан освобождён', text: 'Колыбель машин в руках Демократии. Заводы перепрошивают под нужды фронта.', effects: { warSupport: 10, production: 80 }, major: true },
  { id: 'ev_cap_kepler_se', capture: { planet: 'Кеплер Прайм', by: 'superEarth' }, faction: 'superEarth', title: 'Сильнейший улей выжжен', text: 'Кеплер Прайм зачищен. Термицидные залпы видны из соседних систем.', effects: { warSupport: 8, stability: 5 }, major: true },
  { id: 'ev_cap_sanctuary_se', capture: { planet: "Святилище Скв'бай", by: 'superEarth' }, faction: 'superEarth', title: 'Святилище пало', text: 'Флаг Свободы над алтарями пророка. Жрецы бежали в Бездну.', effects: { warSupport: 8, politicalPower: 40 }, major: true },
  { id: 'ev_cap_superearth_aut', capture: { planet: 'Супер-Земля', by: 'automatons' }, faction: 'automatons', title: 'Стальная пята на колыбели', text: 'Машины маршируют по площадям Супер-Земли. Идеальный порядок. Мёртвый порядок.', effects: { warSupport: 15, production: 100 }, major: true },
  { id: 'ev_cap_superearth_term', capture: { planet: 'Супер-Земля', by: 'terminids' }, faction: 'terminids', title: 'Улей Супер-Земля', text: 'Колыбель человечества затянута паутиной туннелей. Рой доволен.', effects: { mass: 120 }, major: true },
];
