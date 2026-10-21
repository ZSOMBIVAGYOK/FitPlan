// ============================================================
// theme.js — Téma kezelő (Apple Light / Dark mód)
// FitPlan Pro
// ============================================================

// Ha true: a felület kizárólag Dark Mode-ban fut (Light Mode a felhasználónak
// elrejtve, de a teljes kód és logika megőrizve, így szükség esetén egyetlen
// változó false-ra állításával azonnal visszakapcsolható).
export const FORCE_DARK_ONLY = true;

export function initTheme() {
  if (FORCE_DARK_ONLY) {
    applyTheme("dark");

    // Témaváltó gombok és beállítási sor elrejtése
    document.querySelectorAll(".theme-toggle-btn").forEach(btn => {
      btn.style.display = "none";
    });
    const settingsThemeRow = document.getElementById("settings-theme-row");
    if (settingsThemeRow) {
      settingsThemeRow.style.display = "none";
    }
    return;
  }

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
  const targetMode = FORCE_DARK_ONLY ? "dark" : mode;

  if (targetMode === "dark") {
    document.documentElement.classList.add("dark");
    localStorage.setItem("fitplan_theme", "dark");
  } else {
    document.documentElement.classList.remove("dark");
    localStorage.setItem("fitplan_theme", "light");
  }

  // Ikonok és szövegek frissítése
  const isDark = targetMode === "dark";
  document.querySelectorAll(".theme-icon").forEach(icon => {
    icon.className = `theme-icon fa-solid ${isDark ? "fa-sun text-amber-400" : "fa-moon text-slate-600"}`;
  });
  document.querySelectorAll(".theme-label").forEach(lbl => {
    lbl.textContent = isDark ? "Világos mód" : "Sötét mód";
  });

  // Esemény küldése az alkalmazásnak, hogy azonnal frissítse a fejléceket
  window.dispatchEvent(new CustomEvent("fitplan:theme-changed", { detail: targetMode }));
}
