const PLACEHOLDER_SVG =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect fill="#1a1f2e" width="320" height="180"/><text x="160" y="95" text-anchor="middle" fill="#5c6a82" font-family="system-ui,sans-serif" font-size="14">No preview</text></svg>`
  );

const state = {
  /** @type {{ id: string, timestamp: number, url: string, title: string }[]} */
  entries: [],
  page: 1,
  limit: 16,
  gridCols: 4,
  sortOrder: "asc",
  /** When `sortOrder` is `random`, display order (canonical `entries` is unchanged). */
  shuffledItems: null,
  searchQuery: "",
  thumbCache: new Map(),
};

const LS_LIMIT = "vul:limit";
const LS_GRID = "vul:gridCols";
const LS_SORT = "vul:sortOrder";
const LS_SEARCH = "vul:search";
const ALLOWED_LIMITS = new Set([8, 16, 24, 75, 100, 200, 300, 500]);
const ALLOWED_GRIDS = new Set([3, 4, 5, 6, 7, 8]);
const ALLOWED_SORTS = new Set(["asc", "desc", "random"]);

const $ = (id) => document.getElementById(id);

function readSavedLimit() {
  try {
    const v = parseInt(localStorage.getItem(LS_LIMIT) || "", 10);
    if (ALLOWED_LIMITS.has(v)) return v;
  } catch {
    /* ignore */
  }
  return 16;
}

function readSavedGridCols() {
  try {
    const v = parseInt(localStorage.getItem(LS_GRID) || "", 10);
    if (ALLOWED_GRIDS.has(v)) return v;
  } catch {
    /* ignore */
  }
  return 4;
}

function readSavedSortOrder() {
  try {
    const v = localStorage.getItem(LS_SORT) || "";
    if (ALLOWED_SORTS.has(v)) return v;
    if (v === "added") return "asc";
    if (v === "added-desc") return "desc";
    if (v === "az" || v === "za") return "asc";
  } catch {
    /* ignore */
  }
  return "asc";
}

function readSavedSearch() {
  try {
    const v = localStorage.getItem(LS_SEARCH) || "";
    return v.length > 500 ? v.slice(0, 500) : v;
  } catch {
    /* ignore */
  }
  return "";
}

function applyUiPrefs() {
  state.limit = readSavedLimit();
  state.gridCols = readSavedGridCols();
  state.sortOrder = readSavedSortOrder();
  state.searchQuery = readSavedSearch();
}

function persistUiPrefs() {
  try {
    localStorage.setItem(LS_LIMIT, String(state.limit));
    localStorage.setItem(LS_GRID, String(state.gridCols));
    localStorage.setItem(LS_SORT, state.sortOrder);
    localStorage.setItem(LS_SEARCH, state.searchQuery);
  } catch {
    /* ignore */
  }
}

function getFilteredEntries() {
  const q = state.searchQuery.trim().toLowerCase();
  if (!q) return state.entries;
  return state.entries.filter((item) => {
    const url = (item.url || "").toLowerCase();
    const title = (item.title || "").toLowerCase();
    return url.includes(q) || title.includes(q);
  });
}

function openUrlInBrowser(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function shuffleCopy(arr) {
  const a = [...arr];
  shuffleInPlace(a);
  return a;
}

function normalizeDbRows(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw) {
    if (row && typeof row === "object" && typeof row.url === "string") {
      const url = row.url.trim();
      if (!url) continue;
      const ts =
        typeof row.timestamp === "number" && Number.isFinite(row.timestamp)
          ? row.timestamp
          : 0;
      const title =
        typeof row.title === "string" ? row.title.trim().slice(0, 500) : "";
      out.push({
        id: typeof row.id === "string" ? row.id : "",
        timestamp: ts,
        url,
        title,
      });
    } else if (typeof row === "string" && row.trim()) {
      out.push({ id: "", timestamp: 0, url: row.trim(), title: "" });
    }
  }
  return out;
}

function formatItemTime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  try {
    return new Date(n).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

function syncOrderSelect() {
  const sel = $("orderSelect");
  if (!sel) return;
  if (state.sortOrder === "random") {
    sel.value = "";
  } else if (state.sortOrder === "asc" || state.sortOrder === "desc") {
    sel.value = state.sortOrder;
  } else {
    sel.value = "";
  }
}

function getDisplayItems() {
  const u = getFilteredEntries();
  if (u.length === 0) return [];

  if (state.sortOrder === "random") {
    if (!state.shuffledItems || state.shuffledItems.length !== u.length) {
      state.shuffledItems = shuffleCopy(u);
    }
    return state.shuffledItems;
  }

  state.shuffledItems = null;
  const copy = [...u];
  switch (state.sortOrder) {
    case "desc":
      return copy.reverse();
    case "asc":
    default:
      return copy;
  }
}

function totalPages() {
  const n = getDisplayItems().length;
  if (n === 0) return 1;
  return Math.max(1, Math.ceil(n / state.limit));
}

function currentSlice() {
  const list = getDisplayItems();
  const start = (state.page - 1) * state.limit;
  return list.slice(start, start + state.limit);
}

async function loadUrls() {
  const raw = await window.api.dbRead();
  state.entries = normalizeDbRows(raw);
  if (state.sortOrder === "random") {
    state.shuffledItems = shuffleCopy(getFilteredEntries());
  } else {
    state.shuffledItems = null;
  }
  const max = totalPages();
  if (state.page > max) state.page = max;
  render();
}

function render() {
  syncOrderSelect();
  const empty = $("emptyState");
  const emptyMsg = $("emptyStateMsg");
  const grid = $("grid");
  const pager = $("pager");
  const pageInfo = $("pageInfo");
  const btnPrev = $("btnPrev");
  const btnNext = $("btnNext");
  const btnRandom = $("btnRandom");
  const filtered = getFilteredEntries();
  if (btnRandom) {
    btnRandom.disabled = state.entries.length === 0;
  }

  grid.style.setProperty("--cols", String(state.gridCols));

  if (state.entries.length === 0) {
    if (btnRandom) btnRandom.disabled = true;
    if (emptyMsg) {
      emptyMsg.innerHTML = "No URLs yet. Click <strong>Add URL</strong> to save your first link.";
    }
    empty.classList.remove("hidden");
    grid.innerHTML = "";
    pager.classList.add("hidden");
    return;
  }

  if (filtered.length === 0) {
    if (emptyMsg) {
      emptyMsg.innerHTML = "No items match your search. Try another <strong>title</strong> or <strong>URL</strong> term.";
    }
    empty.classList.remove("hidden");
    grid.innerHTML = "";
    pager.classList.add("hidden");
    return;
  }

  empty.classList.add("hidden");
  pager.classList.remove("hidden");

  const pages = totalPages();
  const slice = currentSlice();
  const q = state.searchQuery.trim();
  pageInfo.textContent = q
    ? `Page ${state.page} of ${pages} · ${filtered.length} matching (${state.entries.length} total)`
    : `Page ${state.page} of ${pages} · ${state.entries.length} total`;
  btnPrev.disabled = state.page <= 1;
  btnNext.disabled = state.page >= pages;

  grid.innerHTML = "";
  slice.forEach((item) => {
    const url = item.url;
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.url = url;

    const wrap = document.createElement("div");
    wrap.className = "card-thumb-wrap";
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "button");
    wrap.setAttribute("aria-label", "Open video in browser");
    wrap.title = "Open in browser";
    const openFromThumb = () => openUrlInBrowser(url);
    wrap.addEventListener("click", openFromThumb);
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openFromThumb();
      }
    });
    const img = document.createElement("img");
    img.className = "card-thumb";
    img.alt = item.title || "";
    img.loading = "lazy";
    img.src = PLACEHOLDER_SVG;
    img.draggable = false;
    wrap.appendChild(img);

    const body = document.createElement("div");
    body.className = "card-body";
    const timeRow = document.createElement("div");
    timeRow.className = "card-time";
    timeRow.textContent = formatItemTime(item.timestamp);
    body.appendChild(timeRow);
    if (item.title) {
      const titleRow = document.createElement("div");
      titleRow.className = "card-title";
      titleRow.textContent = item.title;
      body.appendChild(titleRow);
    }
    const line = document.createElement("div");
    line.className = "card-url";
    line.textContent = url;
    const actions = document.createElement("div");
    actions.className = "card-actions";

    const btnOpen = document.createElement("button");
    btnOpen.type = "button";
    btnOpen.className = "btn small";
    btnOpen.textContent = "Open";
    btnOpen.addEventListener("click", () => openUrlInBrowser(url));

    const btnCopy = document.createElement("button");
    btnCopy.type = "button";
    btnCopy.className = "btn small";
    btnCopy.textContent = "Copy";
    btnCopy.addEventListener("click", async () => {
      await window.api.copyText(url);
      btnCopy.textContent = "Copied";
      setTimeout(() => {
        btnCopy.textContent = "Copy";
      }, 1500);
    });

    const btnRemove = document.createElement("button");
    btnRemove.type = "button";
    btnRemove.className = "btn small danger";
    btnRemove.textContent = "Remove";
    btnRemove.addEventListener("click", async () => {
      if (!confirm("Remove this URL from the library?")) return;
      await window.api.dbRemove(url);
      await loadUrls();
    });

    actions.append(btnOpen, btnCopy, btnRemove);
    body.append(line, actions);
    card.append(wrap, body);
    grid.appendChild(card);

    applyThumbnail(img, url);
  });
}

async function applyThumbnail(img, url) {
  if (state.thumbCache.has(url)) {
    const cached = state.thumbCache.get(url);
    if (cached) {
      img.src = cached;
      img.classList.remove("placeholder");
    } else {
      img.src = PLACEHOLDER_SVG;
      img.classList.add("placeholder");
    }
    return;
  }
  try {
    const res = await window.api.thumbnailForUrl(url);
    if (res.type === "url" && res.href) {
      state.thumbCache.set(url, res.href);
      img.onload = () => img.classList.remove("placeholder");
      img.onerror = () => {
        state.thumbCache.set(url, null);
        img.src = PLACEHOLDER_SVG;
        img.classList.add("placeholder");
      };
      img.src = res.href;
      img.classList.remove("placeholder");
    } else {
      state.thumbCache.set(url, null);
      img.src = PLACEHOLDER_SVG;
      img.classList.add("placeholder");
    }
  } catch {
    state.thumbCache.set(url, null);
    img.src = PLACEHOLDER_SVG;
    img.classList.add("placeholder");
  }
}

function looksLikeHttpUrl(string) {
  try {
    const u = new URL(String(string).trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function firstClipboardLine(text) {
  return String(text || '')
    .split(/\r?\n/)[0]
    .trim();
}

async function openModal() {
  $("modalBackdrop").classList.remove("hidden");
  $("modalBackdrop").setAttribute("aria-hidden", "false");
  $("modalError").classList.add("hidden");
  $("modalError").textContent = "";
  $("urlInput").value = "";
  try {
    const clip = await window.api.readClipboardText();
    const line = firstClipboardLine(clip);
    if (line && looksLikeHttpUrl(line)) {
      $("urlInput").value = line;
    }
  } catch {
    /* ignore clipboard errors */
  }
  const input = $("urlInput");
  input.focus();
  const len = input.value.length;
  input.setSelectionRange(len, len);
}

function closeModal() {
  $("modalBackdrop").classList.add("hidden");
  $("modalBackdrop").setAttribute("aria-hidden", "true");
}

async function saveModal() {
  const raw = $("urlInput").value;
  const err = $("modalError");
  const result = await window.api.dbAdd(raw);
  if (!result.ok) {
    err.textContent = result.error || "Could not save.";
    err.classList.remove("hidden");
    return;
  }
  closeModal();
  state.page = 1;
  await loadUrls();
}

function shuffleLibraryOrder() {
  const filtered = getFilteredEntries();
  if (filtered.length === 0) return;
  state.sortOrder = "random";
  state.shuffledItems = shuffleCopy(filtered);
  state.page = 1;
  persistUiPrefs();
  render();
}

let exportDirPath = "";
let importFilePath = "";

function openExportModal() {
  if (!$("lockBackdrop").classList.contains("hidden")) return;
  exportDirPath = "";
  $("exportPathInput").value = "";
  $("exportSubmitBtn").disabled = true;
  const err = $("exportModalError");
  err.textContent = "";
  err.classList.add("hidden");
  $("exportBackdrop").classList.remove("hidden");
  $("exportBackdrop").setAttribute("aria-hidden", "false");
}

function closeExportModal() {
  $("exportBackdrop").classList.add("hidden");
  $("exportBackdrop").setAttribute("aria-hidden", "true");
}

function openImportModal() {
  if (!$("lockBackdrop").classList.contains("hidden")) return;
  importFilePath = "";
  $("importPathInput").value = "";
  $("importSubmitBtn").disabled = true;
  const err = $("importModalError");
  err.textContent = "";
  err.classList.add("hidden");
  $("importBackdrop").classList.remove("hidden");
  $("importBackdrop").setAttribute("aria-hidden", "false");
}

function closeImportModal() {
  $("importBackdrop").classList.add("hidden");
  $("importBackdrop").setAttribute("aria-hidden", "true");
}

function wireExternalLinks() {
  document.querySelectorAll("a[data-external]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const url = a.getAttribute("href");
      if (url && window.api?.openExternal) {
        window.api.openExternal(url);
      }
    });
  });
}

function wire() {
  const y = document.getElementById("footerYear");
  if (y) y.textContent = String(new Date().getFullYear());
  wireExternalLinks();

  const btnRandom = $("btnRandom");
  if (btnRandom) {
    btnRandom.addEventListener("click", shuffleLibraryOrder);
  }
  $("btnAdd").addEventListener("click", openModal);
  $("modalCancel").addEventListener("click", closeModal);
  $("modalSave").addEventListener("click", saveModal);
  $("urlInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveModal();
  });

  $("modalBackdrop").addEventListener("click", (e) => {
    if (e.target === $("modalBackdrop")) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("pinSettingsBackdrop").classList.contains("hidden")) {
      closePinSettingsModal();
      return;
    }
    if (!$("importBackdrop").classList.contains("hidden")) {
      closeImportModal();
      return;
    }
    if (!$("exportBackdrop").classList.contains("hidden")) {
      closeExportModal();
      return;
    }
    if (!$("lockBackdrop").classList.contains("hidden")) return;
    if (!$("modalBackdrop").classList.contains("hidden")) closeModal();
  });

  const searchEl = $("searchInput");
  if (searchEl) {
    searchEl.value = state.searchQuery;
    searchEl.addEventListener("input", () => {
      state.searchQuery = searchEl.value;
      state.page = 1;
      state.shuffledItems = null;
      persistUiPrefs();
      render();
    });
  }

  $("limitSelect").value = String(state.limit);
  $("limitSelect").addEventListener("change", () => {
    const n = parseInt($("limitSelect").value, 10) || 16;
    state.limit = ALLOWED_LIMITS.has(n) ? n : 16;
    state.page = 1;
    persistUiPrefs();
    render();
  });

  $("gridSelect").value = String(state.gridCols);
  $("gridSelect").addEventListener("change", () => {
    const n = parseInt($("gridSelect").value, 10) || 4;
    state.gridCols = ALLOWED_GRIDS.has(n) ? n : 4;
    persistUiPrefs();
    render();
  });

  syncOrderSelect();
  $("orderSelect").addEventListener("change", () => {
    const v = $("orderSelect").value;
    if (v === "desc" || v === "asc") {
      state.sortOrder = v;
      state.shuffledItems = null;
    } else if (v === "") {
      state.sortOrder = "asc";
      state.shuffledItems = null;
    } else {
      return;
    }
    state.page = 1;
    persistUiPrefs();
    render();
  });

  $("btnPrev").addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      render();
    }
  });

  $("btnNext").addEventListener("click", () => {
    if (state.page < totalPages()) {
      state.page += 1;
      render();
    }
  });

  $("exportBrowseBtn").addEventListener("click", async () => {
    const r = await window.api.pickExportDirectory();
    if (r.ok && r.path) {
      exportDirPath = r.path;
      $("exportPathInput").value = r.path;
      $("exportSubmitBtn").disabled = false;
    }
  });
  $("exportCancelBtn").addEventListener("click", () => closeExportModal());
  $("exportSubmitBtn").addEventListener("click", async () => {
    const errEl = $("exportModalError");
    errEl.classList.add("hidden");
    const r = await window.api.exportDataToDirectory(exportDirPath);
    if (!r.ok) {
      errEl.textContent = r.error || "Export failed.";
      errEl.classList.remove("hidden");
      return;
    }
    closeExportModal();
  });
  $("exportBackdrop").addEventListener("click", (e) => {
    if (e.target === $("exportBackdrop")) closeExportModal();
  });

  $("importBrowseBtn").addEventListener("click", async () => {
    const r = await window.api.pickImportFile();
    if (r.ok && r.path) {
      importFilePath = r.path;
      $("importPathInput").value = r.path;
      $("importSubmitBtn").disabled = false;
    }
  });
  $("importCancelBtn").addEventListener("click", () => closeImportModal());
  $("importSubmitBtn").addEventListener("click", async () => {
    const errEl = $("importModalError");
    errEl.classList.add("hidden");
    if (!confirm("Replace your current library with the imported file? This cannot be undone.")) {
      return;
    }
    const r = await window.api.importDataFromFile(importFilePath);
    if (!r.ok) {
      errEl.textContent = r.error || "Import failed.";
      errEl.classList.remove("hidden");
      return;
    }
    state.thumbCache.clear();
    state.page = 1;
    closeImportModal();
    await loadUrls();
  });
  $("importBackdrop").addEventListener("click", (e) => {
    if (e.target === $("importBackdrop")) closeImportModal();
  });

  window.api.onOptionsOpenExport(() => {
    if (!$("lockBackdrop").classList.contains("hidden")) return;
    openExportModal();
  });
  window.api.onOptionsOpenImport(() => {
    if (!$("lockBackdrop").classList.contains("hidden")) return;
    openImportModal();
  });

  wirePinSecurity();
}

let mainDataLoaded = false;

function resetLockInputVisibility() {
  const wrap = document.querySelector("#lockBackdrop .lock-pin-wrap");
  if (!wrap) return;
  const input = wrap.querySelector("#lockInput");
  const btn = wrap.querySelector(".pin-toggle-vis");
  if (!input || !btn) return;
  input.type = "password";
  syncPinToggleButton(btn, input);
}

function showLockScreen() {
  const bd = $("lockBackdrop");
  bd.classList.remove("hidden");
  bd.setAttribute("aria-hidden", "false");
  document.body.classList.add("app-locked");
  $("lockInput").value = "";
  resetLockInputVisibility();
  $("lockError").classList.add("hidden");
  $("lockInput").focus();
}

function hideLockScreen() {
  $("lockBackdrop").classList.add("hidden");
  $("lockBackdrop").setAttribute("aria-hidden", "true");
  document.body.classList.remove("app-locked");
}

async function submitLock() {
  const err = $("lockError");
  err.classList.add("hidden");
  const res = await window.api.securityVerify($("lockInput").value);
  if (!res.ok) {
    err.textContent = "Wrong PIN. Try again.";
    err.classList.remove("hidden");
    $("lockInput").select();
    return;
  }
  hideLockScreen();
  if (!mainDataLoaded) {
    await loadUrls();
    mainDataLoaded = true;
  }
}

function syncPinToggleButton(btn, input) {
  const masked = input.type === "password";
  const eye = btn.querySelector(".icon-eye");
  const eyeOff = btn.querySelector(".icon-eye-off");
  if (eye) eye.classList.toggle("hidden", !masked);
  if (eyeOff) eyeOff.classList.toggle("hidden", masked);
  const label = masked ? "Show PIN" : "Hide PIN";
  btn.setAttribute("aria-label", label);
  btn.setAttribute("title", label);
}

function resetPinSettingsVisibility() {
  document.querySelectorAll("#pinSettingsBackdrop .pin-input-wrap").forEach((wrap) => {
    const input = wrap.querySelector("input");
    const btn = wrap.querySelector(".pin-toggle-vis");
    if (!input || !btn) return;
    input.type = "password";
    syncPinToggleButton(btn, input);
  });
}

function clearPinSettingsFields() {
  ["pinSetNew", "pinSetConfirm", "pinManageCurrent", "pinManageNew", "pinManageConfirm"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  resetPinSettingsVisibility();
  ["pinSetError", "pinManageError"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = "";
      el.classList.add("hidden");
    }
  });
}

async function refreshPinSettingsPanels() {
  const { hasPin } = await window.api.securityPinState();
  $("pinPanelSet").classList.toggle("hidden", hasPin);
  $("pinPanelManage").classList.toggle("hidden", !hasPin);
}

function closePinSettingsModal() {
  $("pinSettingsBackdrop").classList.add("hidden");
  $("pinSettingsBackdrop").setAttribute("aria-hidden", "true");
  clearPinSettingsFields();
}

async function openPinSettingsModal() {
  if (!$("lockBackdrop").classList.contains("hidden")) return;
  clearPinSettingsFields();
  await refreshPinSettingsPanels();
  $("pinSettingsBackdrop").classList.remove("hidden");
  $("pinSettingsBackdrop").setAttribute("aria-hidden", "false");
}

function wirePinSecurity() {
  $("lockSubmit").addEventListener("click", () => submitLock());
  $("lockInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitLock();
  });

  const lockToggle = document.querySelector("#lockBackdrop .lock-pin-wrap .pin-toggle-vis");
  if (lockToggle) {
    lockToggle.addEventListener("click", () => {
      const wrap = lockToggle.closest(".pin-input-wrap");
      const input = wrap && wrap.querySelector("#lockInput");
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
      syncPinToggleButton(lockToggle, input);
    });
  }

  window.api.onSecurityOpenSettings(() => {
    if (!$("lockBackdrop").classList.contains("hidden")) return;
    openPinSettingsModal();
  });

  $("pinSettingsBackdrop").addEventListener("click", (e) => {
    if (e.target === $("pinSettingsBackdrop")) closePinSettingsModal();
  });

  $("pinSetCancel").addEventListener("click", () => closePinSettingsModal());
  $("pinSetSave").addEventListener("click", async () => {
    const errEl = $("pinSetError");
    errEl.classList.add("hidden");
    const res = await window.api.securitySetPin($("pinSetNew").value, $("pinSetConfirm").value);
    if (!res.ok) {
      errEl.textContent = res.error || "Could not set PIN.";
      errEl.classList.remove("hidden");
      return;
    }
    closePinSettingsModal();
  });

  $("pinManageClose").addEventListener("click", () => closePinSettingsModal());

  $("pinChangeBtn").addEventListener("click", async () => {
    const errEl = $("pinManageError");
    errEl.classList.add("hidden");
    const res = await window.api.securityChangePin(
      $("pinManageCurrent").value,
      $("pinManageNew").value,
      $("pinManageConfirm").value
    );
    if (!res.ok) {
      errEl.textContent = res.error || "Could not change PIN.";
      errEl.classList.remove("hidden");
      return;
    }
    closePinSettingsModal();
  });

  $("pinRemoveBtn").addEventListener("click", async () => {
    const errEl = $("pinManageError");
    errEl.classList.add("hidden");
    if (!confirm("Remove PIN protection? Anyone opening the app will not need a PIN.")) return;
    const res = await window.api.securityRemovePin($("pinManageCurrent").value);
    if (!res.ok) {
      errEl.textContent = res.error || "Could not remove PIN.";
      errEl.classList.remove("hidden");
      return;
    }
    closePinSettingsModal();
  });

  document.querySelectorAll("#pinSettingsBackdrop .pin-toggle-vis").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wrap = btn.closest(".pin-input-wrap");
      const input = wrap && wrap.querySelector("input");
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
      syncPinToggleButton(btn, input);
    });
  });
}

applyUiPrefs();
wire();

(async () => {
  const { hasPin } = await window.api.securityPinState();
  if (!hasPin) {
    await loadUrls();
    mainDataLoaded = true;
  } else {
    showLockScreen();
  }
})();
