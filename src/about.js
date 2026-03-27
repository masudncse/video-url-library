const aboutYear = document.getElementById('aboutFooterYear');
if (aboutYear) aboutYear.textContent = String(new Date().getFullYear());

document.querySelectorAll('a[data-external]').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const url = a.getAttribute('href');
    if (url && window.api?.openExternal) {
      window.api.openExternal(url);
    }
  });
});

const closeBtn = document.getElementById('aboutClose');
if (closeBtn) {
  closeBtn.addEventListener('click', () => window.close());
}
