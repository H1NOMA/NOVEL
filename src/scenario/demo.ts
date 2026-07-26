/**
 * Демо-сценарий: маленькая история в нейтральном «демо-полигоне»,
 * которая прогоняет все механики движка: реплики, фоны/спрайты,
 * переменные, условные варианты, ветвление и три концовки.
 *
 * Когда определится сеттинг — этот файл просто заменяется новым сценарием
 * (или несколькими главами), формат тот же. См. docs/SCENARIO_FORMAT.md.
 */
import type { Scenario } from '../engine/types';

export const demoScenario: Scenario = {
  meta: {
    id: 'demo-polygon',
    title: 'Демо-полигон',
    version: 1,
    start: 'intro',
    vars: { trust: 0, curiosity: 0, has_key: false, player: 'Гость' }
  },

  characters: {
    guide: { name: 'Проводница', color: '#7ec8e3' },
    voice: { name: '???', color: '#c9a0ff' },
    player: { name: '{player}', color: '#ffd479' }
  },

  scenes: {
    intro: {
      steps: [
        { type: 'bg', id: 'void' },
        { type: 'music', id: 'ambient' },
        { type: 'say', text: 'Темнота. Потом — мягкий свет, как будто кто-то включил мир рубильником.' },
        { type: 'bg', id: 'polygon' },
        { type: 'show', slot: 'center', id: 'guide' },
        { type: 'say', who: 'guide', text: 'О, вы уже здесь. Добро пожаловать на демо-полигон, {player}.' },
        { type: 'say', who: 'guide', text: 'Сеттинга у этого мира пока нет, поэтому вокруг… ну, вы видите. Геометрия и туман.' },
        { type: 'say', who: 'player', text: 'И что мне здесь делать?' },
        {
          type: 'choice',
          prompt: 'С чего начать?',
          options: [
            { text: 'Осмотреться вокруг', goto: 'explore', set: [{ var: 'curiosity', op: 'add', value: 1 }] },
            { text: 'Расспросить проводницу', goto: 'talk', set: [{ var: 'trust', op: 'add', value: 1 }] }
          ]
        }
      ]
    },

    explore: {
      steps: [
        { type: 'hide', slot: 'center' },
        { type: 'bg', id: 'ruins' },
        { type: 'say', text: 'Вы отходите от проводницы. За туманом — контуры недостроенных декораций: то ли замок, то ли космопорт. Мир ещё не решил.' },
        { type: 'say', text: 'Под ногами что-то блестит. Ключ. Старомодный, с биркой «от двери».' },
        { type: 'set', ops: [{ var: 'has_key', value: true }] },
        { type: 'say', who: 'player', text: 'Подозрительно удобно. Возьму.' },
        { type: 'jump', to: 'hub' }
      ]
    },

    talk: {
      steps: [
        { type: 'say', who: 'player', text: 'Кто вы вообще такая?' },
        { type: 'say', who: 'guide', text: 'Интерфейс с человеческим лицом. Меня дорисуют, когда художник определится со стилем.' },
        { type: 'say', who: 'guide', text: 'Моё дело — показать, что движок работает: переменные, ветвления, сейвы. Остальное — дело сценариста.' },
        { type: 'set', ops: [{ var: 'trust', op: 'add', value: 1 }] },
        { type: 'say', who: 'guide', text: 'Кстати, вы мне уже нравитесь. Это я запомню. В переменной.' },
        { type: 'jump', to: 'hub' }
      ]
    },

    hub: {
      steps: [
        { type: 'bg', id: 'polygon' },
        { type: 'show', slot: 'center', id: 'guide' },
        { type: 'say', who: 'guide', text: 'Итак. Впереди дверь с надписью «РЕЛИЗ». За ней, говорят, Steam.' },
        {
          type: 'choice',
          options: [
            { text: 'Открыть дверь ключом', goto: 'door', cond: { var: 'has_key' } },
            { text: 'Попробовать дверь без ключа', goto: 'door_locked', cond: { not: { var: 'has_key' } } },
            { text: 'Остаться и поболтать ещё', goto: 'stay' }
          ]
        }
      ]
    },

    door_locked: {
      steps: [
        { type: 'say', text: 'Дверь заперта. Разумеется.' },
        { type: 'say', who: 'guide', text: 'Ключ где-то на полигоне. Кто не осматривается — тот не релизится.' },
        { type: 'choice', options: [{ text: 'Пойти осмотреться', goto: 'explore' }] }
      ]
    },

    stay: {
      steps: [
        { type: 'set', ops: [{ var: 'trust', op: 'add', value: 1 }] },
        { type: 'say', who: 'guide', text: 'Похвальная неторопливость. Ранний доступ тоже существует не просто так.' },
        { type: 'say', who: 'voice', text: '…но дедлайны сами себя не сдвинут.' },
        { type: 'jump', to: 'hub' }
      ]
    },

    door: {
      steps: [
        { type: 'say', text: 'Ключ поворачивается с приятным щелчком.' },
        { type: 'branch', cond: { var: 'trust', gte: 2 }, then: 'ending_good', else: 'ending_neutral' }
      ]
    },

    ending_good: {
      steps: [
        { type: 'bg', id: 'dawn' },
        { type: 'say', who: 'guide', text: 'Возьмите меня с собой, {player}. Хорошему релизу нужен хороший персонаж.' },
        { type: 'say', text: 'Вы выходите вместе. Впереди — вишлисты, страница в Steam и настоящий сеттинг.' },
        { type: 'end', ending: 'good' }
      ]
    },

    ending_neutral: {
      steps: [
        { type: 'bg', id: 'dawn' },
        { type: 'say', text: 'Вы выходите в одиночку. Полигон за спиной растворяется в тумане.' },
        { type: 'say', who: 'voice', text: 'Прототип пройден. Теперь — за настоящую историю.' },
        { type: 'end', ending: 'neutral' }
      ]
    }
  }
};
