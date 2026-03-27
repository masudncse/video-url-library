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

const $ = (id) => document.getElementById(id);

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
    const img = document.createElement("img");
    img.className = "card-thumb";
    img.alt = "";
    img.loading = "lazy";
    img.src = PLACEHOLDER_SVG;
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
    btnOpen.addEventListener("click", () => {
      window.open(url, "_blank", "noopener,noreferrer");
    });

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

function openRandomUrl() {
  if (state.urls.length === 0) return;
  const i = Math.floor(Math.random() * state.urls.length);
  const url = state.urls[i];
  window.open(url, "_blank", "noopener,noreferrer");
  state.page = Math.floor(i / state.limit) + 1;
  render();
}

function wire() {
  $("btnRandom").addEventListener("click", openRandomUrl);
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
    if (e.key === "Escape" && !$("modalBackdrop").classList.contains("hidden")) {
      closeModal();
    }
  });

  $("limitSelect").value = String(state.limit);
  $("limitSelect").addEventListener("change", () => {
    state.limit = parseInt($("limitSelect").value, 10) || 16;
    state.page = 1;
    render();
  });

  $("gridSelect").value = String(state.gridCols);
  $("gridSelect").addEventListener("change", () => {
    state.gridCols = parseInt($("gridSelect").value, 10) || 4;
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
}

wire();
loadUrls();
