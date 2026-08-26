// Мост между песочницей рендерера и сетевым слоем главного процесса.
// Здесь намеренно нет ни одного require, кроме 'electron': preload работает
// в песочнице, и любой доступ к node-модулям отсюда невозможен и не нужен —
// сокеты живут в главном процессе (см. electron/net.cjs).
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
ipcRenderer.on('net:event', (_e, payload) => {
  for (const fn of listeners) {
    try {
      fn(payload);
    } catch (err) {
      console.error('Ошибка обработчика сетевого события:', err);
    }
  }
});

contextBridge.exposeInMainWorld('netBridge', {
  /** Поднять сервер партии. → { ok, port, addresses } */
  host: (port) => ipcRenderer.invoke('net:host', port),
  /** Подключиться к хосту. → { ok, error? } */
  join: (host, port) => ipcRenderer.invoke('net:join', { host, port }),
  /** Клиент → хосту. */
  send: (msg) => ipcRenderer.invoke('net:send', msg),
  /** Хост → конкретному игроку. */
  sendTo: (peer, msg) => ipcRenderer.invoke('net:send-to', { peer, msg }),
  /** Хост → всем. */
  broadcast: (msg) => ipcRenderer.invoke('net:broadcast', msg),
  // Хост исключает игрока: причина уходит клиенту, затем канал закрывается.
  drop: (peer, reason) => ipcRenderer.invoke('net:drop', { peer, reason }),
  /** Разорвать всё. */
  close: () => ipcRenderer.invoke('net:close'),
  /** Адреса этой машины для приглашения. */
  addresses: () => ipcRenderer.invoke('net:addresses'),
  // Маяк хоста и поиск партий рядом — соединение без диктовки адреса.
  beacon: (info) => ipcRenderer.invoke('net:beacon', info),
  discover: (ms) => ipcRenderer.invoke('net:discover', ms),
  /** Подписка на события: { kind, from?, msg?, id? }. Возвращает отписку. */
  onEvent: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
});
