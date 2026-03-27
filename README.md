# Video URL Library

Desktop app built with Electron to save and manage video URLs with thumbnails and pagination.

## Screenshot

![Video URL Library main window](screenshot/1.png)

## Requirements

- **Node.js** 18+ (recommended) and **npm**
- **Windows** for the default `npm run dist` / `npm run pack` flows below (NSIS installer and unpacked `dist/win-unpacked`). **macOS** builds (`npm run dist:mac`) must run [on a Mac](https://www.electron.build/multi-platform-build). **Linux** builds (`npm run dist:linux`) run on Linux (or WSL with appropriate setup).
- **Code signing** is optional for local packs; see [Build](#build) to enable it (`build.win.signAndEditExecutable` + `.pfx` + env vars).

## Install

```bash
npm install
```

## Run in development

```bash
npm start
```

**Watch mode** (restart Electron when `src/`, `views/`, or `styles/` change):

```bash
npm run watch
```

Uses [nodemon](https://nodemon.io/) with `nodemon.json`. Or double-click **`start.bat`** for a normal start (`npm start` with Chrome remote debugging on port **8069**).

Development data is stored in **`storage/database.txt`** (one URL per line, **Base64-encoded** UTF-8; older plain `https://…` lines are still read correctly). Packaged builds use **userData** for the same filename.

### PIN lock

Use **Security → PIN settings…** to set, change, or remove a PIN (4–64 characters). If a PIN is set, it is stored (hashed) under the app **userData** folder as `pin-lock.json`; you must enter it each time the app opens.

## Project layout

```
video-url-library/
├── screenshot/     # README image(s)
├── src/              # main.js, preload.js, app.js, about.js
├── views/            # HTML
├── styles/           # CSS
├── storage/          # Dev database (database.txt)
├── images/           # App icon (e.g. icon.png) for electron-builder
├── dist/             # Created by pack/dist (gitignored until you build)
├── nodemon.json      # dev: npm run watch
├── package.json
├── package-lock.json
├── start.bat
└── README.md
```

Git also ignores certificate files like **`*.pfx`** (see `.gitignore`). The **`Video URL Library/`** entry in `.gitignore` is only relevant if you keep a copy of the built app at the repo root.

## Build

**Windows installer (NSIS `.exe` in `dist/`):**

```bash
npm run dist
```

**Unpacked Windows app** (portable-style folder; run **`dist/win-unpacked/Video URL Library.exe`** with `resources/` and `locales/` beside it):

```bash
npm run pack
```

Runs **electron-builder** **`--dir`** → **`dist/win-unpacked/`**.

**Other platforms** (targets are defined under `build.mac` and `build.linux` in `package.json`):

- **`npm run dist:mac`** — DMG and ZIP (Intel + Apple Silicon). Supported **only on macOS**.
- **`npm run dist:linux`** — AppImage and `.deb` (x64). Run on **Linux**.

By default **`build.win.signAndEditExecutable`** is **`false`** so Windows builds work without symlink privileges (electron-builder’s signing tools extract archives that use symlinks; without [Developer Mode](https://learn.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development) or an elevated shell, that step fails).

For **Authenticode signing**, set **`signAndEditExecutable`** to **`true`** in `package.json` → `build.win`, enable **Developer Mode** (or run the build from an elevated prompt), then set [environment variables](https://www.electron.build/code-signing) **before** `npm run dist` or `npm run pack`:

**cmd**

```cmd
set CSC_LINK=C:\path\to\your-codesign.pfx
set CSC_KEY_PASSWORD=your-pfx-password
npm run dist
```

**PowerShell**

```powershell
$env:CSC_LINK = "C:\path\to\your-codesign.pfx"
$env:CSC_KEY_PASSWORD = "your-pfx-password"
npm run dist
```
