// ============================================================
// theme.js — Téma kezelő (Apple Light / Dark mód)
// FitPlan Pro
// ============================================================

export function initTheme() {
  const saved = localStorage.getItem("fitplan_theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const initial = saved ? saved : (prefersDark ? "dark" : "light");

  applyTheme(initial);

  // Gombok bekötése
  document.querySelectorAll(".theme-toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const current = document.documentElement.classList.contains("dark") ? "dark" : "light";
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
    });
  });
}

export function applyTheme(mode) {
  if (mode === "dark") {
    document.documentElement.classList.add("dark");
    localStorage.setItem("fitplan_theme", "dark");
  } else {
    document.documentElement.classList.remove("dark");
    localStorage.setItem("fitplan_theme", "light");
  }

  // Ikonok és szövegek frissítése
  const isDark = mode === "dark";
  document.querySelectorAll(".theme-icon").forEach(icon => {
    icon.className = `theme-icon fa-solid ${isDark ? "fa-sun text-amber-400" : "fa-moon text-slate-600"}`;
  });
  document.querySelectorAll(".theme-label").forEach(lbl => {
    lbl.textContent = isDark ? "Világos mód" : "Sötét mód";
  });
}
