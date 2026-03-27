# Video URL Library

Desktop app built with Electron to save and manage video URLs with thumbnails and pagination.

## Requirements

- Node.js 18+ (recommended)
- npm
- Windows (for installer build scripts in this repo)

## Install

```bash
npm install
```

## Run in Development

```bash
npm start
```

## Build

Create unpacked app:

```bash
npm run pack
```

Create Windows installer:

```bash
npm run dist
```

Build Windows installer with signing/edit options:

```bash
npm run dist:signed
```

Build Windows directory output only:

```bash
npm run dist:dir
```

## Project Files

- `main.js` - Electron main process
- `preload.js` - secure bridge between main and renderer
- `index.html` - main UI
- `about.html` and `about.js` - about window
- `app.js` - renderer logic
- `styles.css` - UI styles
- `database.txt` - local text-based storage

## Code Signing

If you plan to sign the app, check `SIGNING.md` for certificate and signing instructions.
