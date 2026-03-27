const { app, BrowserWindow, ipcMain, clipboard, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const crypto = require('crypto');

const rootDir = path.join(__dirname, '..');
const viewsDir = path.join(rootDir, 'views');
const icoPath = path.join(rootDir, 'images', 'icon.ico');
const pngPath = path.join(rootDir, 'images', 'icon.png');
const windowIcon =
  process.platform === 'win32' && fsSync.existsSync(icoPath) ? icoPath : pngPath;

let mainWindow;
let aboutWindow;

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

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
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  aboutWindow.setMenuBarVisibility(false);
  aboutWindow.loadFile(path.join(viewsDir, 'about.html'));
  aboutWindow.once('ready-to-show', () => aboutWindow.show());
  aboutWindow.on('closed', () => {
    aboutWindow = null;
  });
}

function getDbPath() {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'database.txt');
  }
  return path.join(rootDir, 'storage', 'database.txt');
}

function getPinStorePath() {
  return path.join(app.getPath('userData'), 'pin-lock.json');
}

function validatePinFormat(pin) {
  const s = String(pin || '');
  if (s.length < 4) return 'PIN must be at least 4 characters.';
  if (s.length > 64) return 'PIN must be at most 64 characters.';
  return null;
}

function hashPin(pin, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.pbkdf2Sync(String(pin), salt, 120000, 64, 'sha512').toString('hex');
}

async function readPinRecord() {
  try {
    const raw = await fs.readFile(getPinStorePath(), 'utf8');
    const j = JSON.parse(raw);
    if (j && typeof j.salt === 'string' && typeof j.hash === 'string') return j;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return null;
}

function timingSafeEqualHex(a, b) {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function isHttpUrl(string) {
  try {
    const u = new URL(string.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** One line in the DB file: Base64(UTF-8 URL). Legacy plain https? URLs still read OK. */
function encodeUrlForStorage(url) {
  return Buffer.from(String(url).trim(), 'utf8').toString('base64');
}

function decodeUrlFromStorage(line) {
  const s = String(line).trim();
  if (!s) return '';
  if (isHttpUrl(s)) return s;
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8');
    if (isHttpUrl(decoded)) return decoded.trim();
  } catch {
    /* invalid base64 */
  }
  return '';
}

function parseStoredDbToUrls(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((l) => decodeUrlFromStorage(l))
    .filter(Boolean);
}

function urlsToStorageText(urls) {
  if (!urls.length) return '';
  return `${urls.map(encodeUrlForStorage).join('\n')}\n`;
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
    return parseStoredDbToUrls(raw);
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
    lines = parseStoredDbToUrls(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (lines.includes(trimmed)) {
    return { ok: false, error: 'This URL is already in the list.' };
  }
  lines.push(trimmed);
  await ensureParentDir(p);
  await fs.writeFile(p, urlsToStorageText(lines), 'utf8');
  return { ok: true };
});

ipcMain.handle('db-remove', async (_e, urlToRemove) => {
  const target = String(urlToRemove || '').trim();
  const p = getDbPath();
  let lines = [];
  try {
    const raw = await fs.readFile(p, 'utf8');
    lines = parseStoredDbToUrls(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true };
    throw err;
  }
  const next = lines.filter((u) => u !== target);
  await ensureParentDir(p);
  await fs.writeFile(p, urlsToStorageText(next), 'utf8');
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

ipcMain.handle('security-pin-state', async () => {
  const rec = await readPinRecord();
  return { hasPin: !!rec };
});

ipcMain.handle('security-verify', async (_e, pin) => {
  const rec = await readPinRecord();
  if (!rec) return { ok: true };
  const h = hashPin(pin, rec.salt);
  return { ok: timingSafeEqualHex(h, rec.hash) };
});

ipcMain.handle('security-set-pin', async (_e, { newPin, newPinConfirm }) => {
  const err = validatePinFormat(newPin);
  if (err) return { ok: false, error: err };
  if (String(newPin) !== String(newPinConfirm)) return { ok: false, error: 'PINs do not match.' };
  const existing = await readPinRecord();
  if (existing) return { ok: false, error: 'A PIN is already set. Use Change PIN.' };
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = hashPin(newPin, salt);
  const p = getPinStorePath();
  await ensureParentDir(p);
  await fs.writeFile(p, JSON.stringify({ salt, hash }), 'utf8');
  return { ok: true };
});

ipcMain.handle('security-change-pin', async (_e, { currentPin, newPin, newPinConfirm }) => {
  const existing = await readPinRecord();
  if (!existing) return { ok: false, error: 'No PIN is set.' };
  const h = hashPin(currentPin, existing.salt);
  if (!timingSafeEqualHex(h, existing.hash)) {
    return { ok: false, error: 'Current PIN is incorrect.' };
  }
  const err = validatePinFormat(newPin);
  if (err) return { ok: false, error: err };
  if (String(newPin) !== String(newPinConfirm)) return { ok: false, error: 'New PINs do not match.' };
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = hashPin(newPin, salt);
  await fs.writeFile(getPinStorePath(), JSON.stringify({ salt, hash }), 'utf8');
  return { ok: true };
});

ipcMain.handle('security-remove-pin', async (_e, { currentPin }) => {
  const existing = await readPinRecord();
  if (!existing) return { ok: false, error: 'No PIN is set.' };
  const h = hashPin(currentPin, existing.salt);
  if (!timingSafeEqualHex(h, existing.hash)) {
    return { ok: false, error: 'PIN is incorrect.' };
  }
  await fs.unlink(getPinStorePath());
  return { ok: true };
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 800,
    minHeight: 560,
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(viewsDir, 'index.html'));
}

function sendSecuritySettings() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('security-open-settings');
  }
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [{ role: 'quit', label: 'Exit' }],
    },
    {
      label: 'Security',
      submenu: [
        {
          label: 'PIN settings…',
          click: () => sendSecuritySettings(),
        },
      ],
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
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.managedurl.videolibrary');
  }
  buildMenu();
  createWindow();
});
app.on('window-all-closed', () => app.quit());
