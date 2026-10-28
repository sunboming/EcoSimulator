type Theme = 'light' | 'dark';
const storageKey = 'wildhaven-theme';
const systemTheme = matchMedia('(prefers-color-scheme: light)');
let preference: Theme | null = null;
try {
  const saved = localStorage.getItem(storageKey);
  if (saved === 'light' || saved === 'dark') preference = saved;
} catch { /* Theme switching still works when browser storage is unavailable. */ }

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f2f5ed' : '#0d1714');
  const button = document.querySelector<HTMLButtonElement>('.theme-toggle');
  if (button) {
    button.textContent = theme === 'light' ? '☾ 暗模式' : '☀ 亮模式';
    button.setAttribute('aria-label', theme === 'light' ? '切换到暗模式' : '切换到亮模式');
    button.title = `当前为${theme === 'light' ? '亮' : '暗'}模式`;
  }
  window.dispatchEvent(new Event('themechange'));
}
applyTheme(preference ?? (systemTheme.matches ? 'light' : 'dark'));
document.querySelector<HTMLButtonElement>('.theme-toggle')?.addEventListener('click', () => {
  preference = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  try { localStorage.setItem(storageKey, preference); } catch { /* Keep the in-memory choice. */ }
  applyTheme(preference);
});
systemTheme.addEventListener('change', () => { if (!preference) applyTheme(systemTheme.matches ? 'light' : 'dark'); });
window.addEventListener('storage', event => {
  if (event.key !== storageKey && event.key !== null) return;
  preference = event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : null;
  applyTheme(preference ?? (systemTheme.matches ? 'light' : 'dark'));
});

export function chartPalette() {
  const css = getComputedStyle(document.documentElement);
  const value = (name: string) => css.getPropertyValue(`--${name}`).trim();
  return { plants: value('lime'), grazers: value('mint'), hunters: value('orange'), births: value('pale'), water: value('blue'), grid: value('chart-grid'), axis: value('chart-axis'), cursor: value('chart-cursor') };
}
