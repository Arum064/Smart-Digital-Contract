// ------- NOTIFICATION & PROFILE DROPDOWN -------
(function () {
  const notifBtn = document.getElementById("notificationBtn");
  const notifDropdown = document.getElementById("notificationDropdown");
  const profile = document.getElementById("userProfile");
  const profileDropdown = document.getElementById("profileDropdown");

  if (notifBtn && notifDropdown) {
    notifBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      notifDropdown.classList.toggle("dropdown-show");
      profileDropdown && profileDropdown.classList.remove("dropdown-show");
    });
  }

  if (profile && profileDropdown) {
    profile.addEventListener("click", function (e) {
      e.stopPropagation();
      profileDropdown.classList.toggle("dropdown-show");
      notifDropdown && notifDropdown.classList.remove("dropdown-show");
    });
  }

  document.addEventListener("click", function () {
    notifDropdown && notifDropdown.classList.remove("dropdown-show");
    profileDropdown && profileDropdown.classList.remove("dropdown-show");
  });
})();

// ------- SEARCH SIMPLE ACTION -------
(function () {
  const searchInput = document.getElementById("searchInput");
  if (!searchInput) return;

  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      const value = searchInput.value.trim();
      if (value) {
        alert('Pencarian: "' + value + '" (demo search)');
      }
    }
  });
})();

// ------- APPEARANCE LOGIC (Theme, Font Size, Language) -------
(function () {
  const themeSelect = document.getElementById("themeSelect");
  const fontSizeSelect = document.getElementById("fontSizeSelect");
  const languageSelect = document.getElementById("languageSelect");
  const btnSave = document.getElementById("btnSave");
  const btnCancel = document.getElementById("btnCancel");

  // helper untuk apply setting ke body (preview sederhana)
  function applyTheme(value) {
    document.body.classList.remove("theme-light", "theme-dark", "theme-device");
    document.body.classList.add(`theme-${value}`);
  }

  function applyFontSize(value) {
    document.documentElement.style.fontSize = {
      xs: "12px",
      sm: "13px",
      md: "14px",
      lg: "15px",
      xl: "16px",
    }[value] || "14px";
  }

  function loadFromStorage() {
    const storedTheme = localStorage.getItem("cd_theme");
    const storedFont = localStorage.getItem("cd_font_size");
    const storedLang = localStorage.getItem("cd_language");

    if (storedTheme && themeSelect) {
      themeSelect.value = storedTheme;
      applyTheme(storedTheme);
    }

    if (storedFont && fontSizeSelect) {
      fontSizeSelect.value = storedFont;
      applyFontSize(storedFont);
    }

    if (storedLang && languageSelect) {
      languageSelect.value = storedLang;
    }
  }

  function saveToStorage() {
    if (themeSelect) localStorage.setItem("cd_theme", themeSelect.value);
    if (fontSizeSelect)
      localStorage.setItem("cd_font_size", fontSizeSelect.value);
    if (languageSelect)
      localStorage.setItem("cd_language", languageSelect.value);
  }

  // Event change → preview langsung
  if (themeSelect) {
    themeSelect.addEventListener("change", () => {
      applyTheme(themeSelect.value);
    });
  }

  if (fontSizeSelect) {
    fontSizeSelect.addEventListener("change", () => {
      applyFontSize(fontSizeSelect.value);
    });
  }

  // Save / Cancel
  if (btnSave) {
    btnSave.addEventListener("click", () => {
      saveToStorage();
      alert("Appearance settings saved (demo).");
    });
  }

  if (btnCancel) {
    btnCancel.addEventListener("click", () => {
      if (confirm("Batalkan perubahan tampilan dan muat ulang halaman?")) {
        window.location.reload();
      }
    });
  }

  // pertama kali load
  loadFromStorage();
})();
