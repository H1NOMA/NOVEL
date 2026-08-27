import { logoBlock } from './logo';
import { CREDITS } from '../data/credits';

// ---------------------------------------------------------------------------
// Титры.
//
// Экран гаснет в чёрное, из темноты выплывает знак игры, и снизу вверх идёт
// список — как и положено титрам. Уходят они по нажатию любой клавиши, по
// щелчку или сами, когда лента доедет до конца.
//
// Скорость подбирается под длину ленты, а не задаётся числом: список ещё
// вырастет, и жёсткая длительность превратила бы его то в спринт, то в
// многоминутное ползание. Здесь фиксирована скорость в пикселях в секунду —
// сколько бы строк ни добавилось, читаются они одинаково.
// ---------------------------------------------------------------------------

/** Пикселей в секунду, с которыми лента ползёт вверх. */
const SCROLL_SPEED = 58;
/** Затухание экрана перед титрами и после них, мс. */
const FADE_MS = 900;

function creditsHTML(): string {
  const blocks = CREDITS.map((b) => {
    const title = b.title ? `<div class="cr-title">${b.title}</div>` : '';
    const roles = (b.roles ?? []).map((r) => `
      <div class="cr-role">
        ${r.role ? `<div class="cr-job">${r.role}</div>` : ''}
        ${r.names.map((n) => `<div class="cr-name">${n}</div>`).join('')}
      </div>`).join('');
    const note = b.note ? `<div class="cr-note">${b.note}</div>` : '';
    return `<section class="cr-block">${title}${roles}${note}</section>`;
  }).join('');
  return `<div class="cr-logo">${logoBlock()}</div>${blocks}<div class="cr-end">✦</div>`;
}

/**
 * Показать титры поверх всего. Возвращает промис, который разрешается, когда
 * экран снова чист: вызывающая сторона может ничего про них не знать.
 */
export function playCredits(host: HTMLElement = document.body): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'credits';
    overlay.className = 'fading';
    overlay.innerHTML = `<div class="cr-scroll"><div class="cr-reel">${creditsHTML()}</div></div>`;
    host.appendChild(overlay);

    const reel = overlay.querySelector<HTMLElement>('.cr-reel')!;
    let done = false;
    let timer = 0;

    const finish = (): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      overlay.removeEventListener('click', finish);
      // Уводим тем же затемнением, каким пришли.
      overlay.classList.add('fading');
      window.setTimeout(() => {
        overlay.remove();
        resolve();
      }, FADE_MS);
    };
    const onKey = (): void => finish();

    // Появление и запуск ленты — в следующем кадре, чтобы браузер успел
    // применить начальное состояние и анимация не «прыгнула» с середины.
    requestAnimationFrame(() => {
      overlay.classList.remove('fading');
      const travel = reel.offsetHeight + overlay.offsetHeight;
      const seconds = Math.max(20, travel / SCROLL_SPEED);
      reel.style.setProperty('--cr-time', `${seconds}s`);
      reel.classList.add('rolling');
      // Лента доехала — гасим сами, не дожидаясь клавиши.
      timer = window.setTimeout(finish, (seconds + FADE_MS / 1000) * 1000);
    });

    window.addEventListener('keydown', onKey);
    overlay.addEventListener('click', finish);
  });
}
