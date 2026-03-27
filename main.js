const { app, BrowserWindow, ipcMain, clipboard, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');

let mainWindow;
let aboutWindow;

function openAboutWindow() {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus();
    return;
  }
  aboutWindow = new BrowserWindow({
    width: 440,
    height: 520,
    minWidth: 360,
    minHeight: 420,
    parent: mainWindow || undefined,
    modal: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  aboutWindow.setMenuBarVisibility(false);
  aboutWindow.loadFile(path.join(__dirname, 'about.html'));
  aboutWindow.once('ready-to-show', () => aboutWindow.show());
  aboutWindow.on('closed', () => {
    aboutWindow = null;
  });
}

function getDbPath() {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'database.txt');
  }
  return path.join(app.getAppPath(), 'database.txt');
}

function isHttpUrl(string) {
  try {
    const u = new URL(string.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function youtubeVideoId(url) {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'www.youtube.com') {
      const v = u.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[1];
      const s = u.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (s) return s[1];
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchOgImage(pageUrl) {
  const res = await fetch(pageUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const m =
    html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i) ||
    html.match(/name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
  return m ? m[1].trim() : null;
}

ipcMain.handle('db-read', async () => {
  const p = getDbPath();
  try {
    const raw = await fs.readFile(p, 'utf8');
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
});

ipcMain.handle('db-add', async (_e, url) => {
  const trimmed = String(url || '').trim();
  if (!isHttpUrl(trimmed)) {
    return { ok: false, error: 'Enter a valid http(s) URL.' };
  }
  const p = getDbPath();
  let lines = [];
  try {
    const raw = await fs.readFile(p, 'utf8');
    lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (lines.includes(trimmed)) {
    return { ok: false, error: 'This URL is already in the list.' };
  }
  lines.push(trimmed);
  await fs.writeFile(p, lines.join('\n') + '\n', 'utf8');
  return { ok: true };
});

ipcMain.handle('db-remove', async (_e, urlToRemove) => {
  const target = String(urlToRemove || '').trim();
  const p = getDbPath();
  let lines = [];
  try {
    const raw = await fs.readFile(p, 'utf8');
    lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true };
    throw err;
  }
  const next = lines.filter((u) => u !== target);
  await fs.writeFile(p, next.join('\n') + (next.length ? '\n' : ''), 'utf8');
  return { ok: true };
});

ipcMain.handle('thumbnail-for-url', async (_e, url) => {
  const trimmed = String(url || '').trim();
  const yid = youtubeVideoId(trimmed);
  if (yid) {
    return {
      type: 'url',
      href: `https://img.youtube.com/vi/${yid}/mqdefault.jpg`,
    };
  }
  try {
    const og = await fetchOgImage(trimmed);
    if (og) return { type: 'url', href: og };
  } catch {
    /* ignore */
  }
  return { type: 'placeholder' };
});

ipcMain.handle('copy-text', async (_e, text) => {
  clipboard.writeText(String(text || ''));
  return true;
});

ipcMain.handle('show-about', () => {
  openAboutWindow();
  return true;
});

ipcMain.handle('open-external', async (_e, url) => {
  const u = String(url || '').trim();
  if (!u) return false;
  if (!/^https?:\/\//i.test(u) && !/^tel:/i.test(u) && !/^mailto:/i.test(u)) {
    return false;
  }
  await shell.openExternal(u);
  return true;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 800,
    minHeight: 560,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [{ role: 'quit', label: 'Exit' }],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => openAboutWindow(),
        },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
});
app.on('window-all-closed', () => app.quit());
