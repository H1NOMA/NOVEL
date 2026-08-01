// Electron main process for The Second Galactic War desktop build.
const { app, BrowserWindow, globalShortcut, screen } = require('electron');
const path = require('path');

// The game is a pure static bundle in dist/ — no Node integration needed.
const DIST_INDEX = path.join(__dirname, '..', 'dist', 'index.html');

// Safety net for machines with broken/blocklisted GPU drivers: allow the
// software (SwiftShader) WebGL fallback instead of failing to render at all.
// On healthy GPUs this switch changes nothing.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(1680, width),
    height: Math.min(1000, height),
    minWidth: 1100,
    minHeight: 700,
    fullscreen: true,
    show: false,
    backgroundColor: '#05070f',
    autoHideMenuBar: true,
    title: 'Вторая Галактическая война',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(DIST_INDEX);
  win.once('ready-to-show', () => win.show());

  // Keep the window title fixed (the page never changes it, but just in case).
  win.on('page-title-updated', (e) => e.preventDefault());
  return win;
}

app.whenReady().then(() => {
  const win = createWindow();

  // F11 — toggle fullscreen, the classic desktop-game binding.
  globalShortcut.register('F11', () => {
    const w = BrowserWindow.getFocusedWindow() ?? win;
    w.setFullScreen(!w.isFullScreen());
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
