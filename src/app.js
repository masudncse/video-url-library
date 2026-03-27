const PLACEHOLDER_SVG =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect fill="#1a1f2e" width="320" height="180"/><text x="160" y="95" text-anchor="middle" fill="#5c6a82" font-family="system-ui,sans-serif" font-size="14">No preview</text></svg>`
  );

const state = {
  urls: [],
  page: 1,
  limit: 16,
  gridCols: 4,
  thumbCache: new Map(),
};

const LS_LIMIT = "vul:limit";
const LS_GRID = "vul:gridCols";
const ALLOWED_LIMITS = new Set([8, 12, 16, 24, 32, 48]);
const ALLOWED_GRIDS = new Set([3, 4, 5, 6]);

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

function applyUiPrefs() {
  state.limit = readSavedLimit();
  state.gridCols = readSavedGridCols();
}

function persistUiPrefs() {
  try {
    localStorage.setItem(LS_LIMIT, String(state.limit));
    localStorage.setItem(LS_GRID, String(state.gridCols));
  } catch {
    /* ignore */
  }
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

function totalPages() {
  const n = state.urls.length;
  if (n === 0) return 1;
  return Math.max(1, Math.ceil(n / state.limit));
}

function currentSlice() {
  const start = (state.page - 1) * state.limit;
  return state.urls.slice(start, start + state.limit);
}

async function loadUrls() {
  state.urls = await window.api.dbRead();
  const max = totalPages();
  if (state.page > max) state.page = max;
  render();
}

function render() {
  const empty = $("emptyState");
  const grid = $("grid");
  const pager = $("pager");
  const pageInfo = $("pageInfo");
  const btnPrev = $("btnPrev");
  const btnNext = $("btnNext");
  const btnRandom = $("btnRandom");
  if (btnRandom) {
    btnRandom.disabled = state.urls.length === 0;
  }

  grid.style.setProperty("--cols", String(state.gridCols));

  if (state.urls.length === 0) {
    empty.classList.remove("hidden");
    grid.innerHTML = "";
    pager.classList.add("hidden");
    return;
  }

  empty.classList.add("hidden");
  pager.classList.remove("hidden");

  const pages = totalPages();
  const slice = currentSlice();
  pageInfo.textContent = `Page ${state.page} of ${pages} · ${state.urls.length} total`;
  btnPrev.disabled = state.page <= 1;
  btnNext.disabled = state.page >= pages;

  grid.innerHTML = "";
  slice.forEach((url) => {
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
    img.alt = "";
    img.loading = "lazy";
    img.src = PLACEHOLDER_SVG;
    img.draggable = false;
    wrap.appendChild(img);

    const body = document.createElement("div");
    body.className = "card-body";
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

function openModal() {
  $("modalBackdrop").classList.remove("hidden");
  $("modalBackdrop").setAttribute("aria-hidden", "false");
  $("modalError").classList.add("hidden");
  $("modalError").textContent = "";
  $("urlInput").value = "";
  $("urlInput").focus();
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
  if (state.urls.length === 0) return;
  shuffleInPlace(state.urls);
  state.page = 1;
  render();
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

  $("btnRandom").addEventListener("click", shuffleLibraryOrder);
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
    if (!$("lockBackdrop").classList.contains("hidden")) return;
    if (!$("modalBackdrop").classList.contains("hidden")) closeModal();
  });

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

  wirePinSecurity();
}

let mainDataLoaded = false;

function showLockScreen() {
  const bd = $("lockBackdrop");
  bd.classList.remove("hidden");
  bd.setAttribute("aria-hidden", "false");
  document.body.classList.add("app-locked");
  $("lockInput").value = "";
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

function clearPinSettingsFields() {
  ["pinSetNew", "pinSetConfirm", "pinManageCurrent", "pinManageNew", "pinManageConfirm"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
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
