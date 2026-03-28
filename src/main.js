const { app, BrowserWindow, ipcMain, clipboard, Menu, shell, dialog } = require('electron');
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
    return path.join(app.getPath('userData'), 'data.json');
  }
  return path.join(rootDir, 'storage', 'data.json');
}

/** Previous JSON filename; migrated once to `data.json`. */
function getLegacyDatabaseJsonPath() {
  return path.join(path.dirname(getDbPath()), 'database.json');
}

/** Legacy plain-text DB path (one URL per line; optional Base64). Migrated once to `data.json`. */
function getLegacyTxtDbPath() {
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

/** Legacy `.txt` line: plain `http(s)` URL or Base64(UTF-8 URL). */
function decodeUrlFromLegacyTxtLine(line) {
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

function parseLegacyTxtToUrls(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((l) => decodeUrlFromLegacyTxtLine(l))
    .filter(Boolean);
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomId6() {
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return s;
}

/** @param {Set<string>} usedIds */
function newUniqueId(usedIds) {
  let id;
  do {
    id = randomId6();
  } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

function isValidEntryId(s) {
  return typeof s === 'string' && /^[A-Za-z0-9]{6}$/.test(s);
}

const MAX_TITLE_LEN = 500;

function normalizeStoredTitle(s) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, MAX_TITLE_LEN);
}

function decodeBasicHtmlEntities(s) {
  return String(s)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

function parseDbEntryFields(row) {
  if (!row || typeof row.url !== 'string') return null;
  const url = row.url.trim();
  if (!isHttpUrl(url)) return null;
  const title = normalizeStoredTitle(row.title);
  let ts = row.timestamp;
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    return { timestamp: Math.trunc(ts), url, title };
  }
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    if (!Number.isNaN(parsed)) return { timestamp: parsed, url, title };
  }
  return { timestamp: Date.now(), url, title };
}

function sortEntriesByTimestamp(entries) {
  return [...entries].sort((a, b) => a.timestamp - b.timestamp);
}

function formatDbJson(entries) {
  return `${JSON.stringify(sortEntriesByTimestamp(entries), null, 2)}\n`;
}

/** e.g. `data-2026-03-28.json` (local date). */
function exportDataFileName() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `data-${y}-${m}-${day}.json`;
}

function entriesFromParsedArray(data) {
  if (!Array.isArray(data)) return [];
  const usedIds = new Set();
  const out = [];
  for (const row of data) {
    const parsed = parseDbEntryFields(row);
    if (!parsed) continue;
    let id =
      isValidEntryId(row.id) && !usedIds.has(row.id) ? row.id : newUniqueId(usedIds);
    if (!usedIds.has(id)) usedIds.add(id);
    out.push({ id, timestamp: parsed.timestamp, url: parsed.url, title: parsed.title || '' });
  }
  return sortEntriesByTimestamp(out);
}

async function migrateLegacyDatabaseJsonToData() {
  const oldPath = getLegacyDatabaseJsonPath();
  let raw;
  try {
    raw = await fs.readFile(oldPath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = [];
  }
  const entries = entriesFromParsedArray(data);
  const newPath = getDbPath();
  await ensureParentDir(newPath);
  await fs.writeFile(newPath, formatDbJson(entries), 'utf8');
  try {
    await fs.unlink(oldPath);
  } catch {
    /* ignore */
  }
  return entries;
}

async function migrateLegacyTxtToJson() {
  const txtPath = getLegacyTxtDbPath();
  let raw;
  try {
    raw = await fs.readFile(txtPath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const urls = parseLegacyTxtToUrls(raw);
  const base = Date.now();
  const usedIds = new Set();
  const entries = urls.map((url, i) => ({
    id: newUniqueId(usedIds),
    timestamp: base + i,
    url,
    title: '',
  }));
  const jsonPath = getDbPath();
  await ensureParentDir(jsonPath);
  await fs.writeFile(jsonPath, formatDbJson(entries), 'utf8');
  return entries;
}

async function readDbEntries() {
  const jsonPath = getDbPath();
  let raw;
  try {
    raw = await fs.readFile(jsonPath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      const fromOldJson = await migrateLegacyDatabaseJsonToData();
      if (fromOldJson !== null) return fromOldJson;
      return migrateLegacyTxtToJson();
    }
    throw e;
  }
  try {
    const data = JSON.parse(raw);
    return entriesFromParsedArray(data);
  } catch {
    return [];
  }
}

async function writeDbEntries(entries) {
  const jsonPath = getDbPath();
  await ensureParentDir(jsonPath);
  await fs.writeFile(jsonPath, formatDbJson(entries), 'utf8');
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

async function fetchHtmlForMeta(pageUrl) {
  const res = await fetch(pageUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) return null;
  return res.text();
}

async function fetchOgImage(pageUrl) {
  const html = await fetchHtmlForMeta(pageUrl);
  if (!html) return null;
  const m =
    html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i) ||
    html.match(/name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
  return m ? m[1].trim() : null;
}

async function fetchPageTitle(pageUrl) {
  try {
    const html = await fetchHtmlForMeta(pageUrl);
    if (!html) return '';
    const og =
      html.match(/property=["']og:title["']\s+content=["']([^"']*)["']/i) ||
      html.match(/content=["']([^"']*)["']\s+property=["']og:title["']/i);
    if (og && og[1]) {
      return normalizeStoredTitle(decodeBasicHtmlEntities(og[1].trim()));
    }
    const tw = html.match(/name=["']twitter:title["']\s+content=["']([^"']*)["']/i);
    if (tw && tw[1]) {
      return normalizeStoredTitle(decodeBasicHtmlEntities(tw[1].trim()));
    }
    const titleM = html.match(/<title[^>]*>([^<]*)<\/title>/is);
    if (titleM && titleM[1]) {
      return normalizeStoredTitle(decodeBasicHtmlEntities(titleM[1].replace(/\s+/g, ' ').trim()));
    }
  } catch {
    /* ignore */
  }
  return '';
}

ipcMain.handle('db-read', async () => {
  const entries = await readDbEntries();
  return entries.map((e) => ({
    id: e.id,
    timestamp: e.timestamp,
    url: e.url,
    title: typeof e.title === 'string' ? e.title : '',
  }));
});

ipcMain.handle('db-add', async (_e, url) => {
  const trimmed = String(url || '').trim();
  if (!isHttpUrl(trimmed)) {
    return { ok: false, error: 'Enter a valid http(s) URL.' };
  }
  const entries = await readDbEntries();
  if (entries.some((e) => e.url === trimmed)) {
    return { ok: false, error: 'This URL is already in the list.' };
  }
  const usedIds = new Set(entries.map((e) => e.id));
  const title = await fetchPageTitle(trimmed);
  entries.push({
    id: newUniqueId(usedIds),
    timestamp: Date.now(),
    url: trimmed,
    title,
  });
  await writeDbEntries(entries);
  return { ok: true };
});

ipcMain.handle('db-remove', async (_e, urlToRemove) => {
  const target = String(urlToRemove || '').trim();
  const entries = await readDbEntries();
  const next = entries.filter((e) => e.url !== target);
  await writeDbEntries(next);
  return { ok: true };
});

function getMainWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

ipcMain.handle('pick-export-directory', async () => {
  const win = getMainWindow();
  const r = await dialog.showOpenDialog(win || undefined, {
    title: 'Choose folder for export',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) {
    return { ok: false, path: null };
  }
  return { ok: true, path: r.filePaths[0] };
});

ipcMain.handle('pick-import-file', async () => {
  const win = getMainWindow();
  const r = await dialog.showOpenDialog(win || undefined, {
    title: 'Choose JSON file to import',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePaths[0]) {
    return { ok: false, path: null };
  }
  return { ok: true, path: r.filePaths[0] };
});

ipcMain.handle('export-data-to-directory', async (_e, dirPath) => {
  const dir = String(dirPath || '').trim();
  if (!dir) {
    return { ok: false, error: 'No folder selected.' };
  }
  const entries = await readDbEntries();
  const name = exportDataFileName();
  const dest = path.join(dir, name);
  await ensureParentDir(dest);
  await fs.writeFile(dest, formatDbJson(entries), 'utf8');
  return { ok: true, fileName: name };
});

ipcMain.handle('import-data-from-file', async (_e, filePath) => {
  const fp = String(filePath || '').trim();
  if (!fp) {
    return { ok: false, error: 'No file selected.' };
  }
  let raw;
  try {
    raw = await fs.readFile(fp, 'utf8');
  } catch {
    return { ok: false, error: 'Could not read file.' };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Invalid JSON.' };
  }
  const entries = entriesFromParsedArray(data);
  await writeDbEntries(entries);
  return { ok: true, count: entries.length };
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

ipcMain.handle('read-clipboard-text', async () => clipboard.readText());

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

function sendOptionsOpenExport() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('options-open-export');
  }
}

function sendOptionsOpenImport() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('options-open-import');
  }
}

function sendOptionsOpenPostView() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('options-open-post-view');
  }
}

function buildMenu() {
  /* Submenu padding and item height are drawn by the OS (Win/macOS/Linux); Electron does not expose spacing APIs. */
  const template = [
    {
      label: 'File',
      submenu: [{ role: 'quit', label: 'Exit' }],
    },
    { type: 'separator' },
    {
      label: 'Security',
      submenu: [
        {
          label: 'PIN settings',
          click: () => sendSecuritySettings(),
        },
      ],
    },
    { type: 'separator' },
    {
      label: 'Options',
      submenu: [
        {
          label: 'Setting',
          click: () => sendOptionsOpenPostView(),
        },
        { type: 'separator' },
        {
          label: 'Export',
          click: () => sendOptionsOpenExport(),
        },
        { type: 'separator' },
        {
          label: 'Import',
          click: () => sendOptionsOpenImport(),
        },
      ],
    },
    { type: 'separator' },
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
