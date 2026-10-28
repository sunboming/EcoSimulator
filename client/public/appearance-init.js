// Blocking local script: select a theme before paint without requiring inline CSP permissions.
try {
  var savedTheme = localStorage.getItem('wildhaven-theme');
  document.documentElement.dataset.theme = savedTheme === 'light' || savedTheme === 'dark'
    ? savedTheme : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
} catch {
  document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
