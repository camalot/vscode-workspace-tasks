---
---

  (function () {
    'use strict';

    var storageKey = 'workspace-tasks-docs-theme';
    var defaultTheme = 'dracula';
    var themes = {
      breeze: {
        label: 'Breeze',
        href: '{{ "/assets/css/theme-breeze.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      hotdog: {
        label: 'Chicago Hotdog',
        href: '{{ "/assets/css/theme-hotdog.css" | prepend: site.baseurl }}',
        colorScheme: 'light',
      },
      cyberpunk2077: {
        label: 'Cyberpunk 2077',
        href: '{{ "/assets/css/theme-cyberpunk2077.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      dracula: {
        label: 'Dracula',
        href: '{{ "/assets/css/theme-dracula.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      "fairy-floss-dark": {
        label: 'Fairy Floss Dark',
        href: '{{ "/assets/css/theme-fairy-floss-dark.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      gogh: {
        label: 'Gogh',
        href: '{{ "/assets/css/theme-gogh.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      "grass": {
        label: 'Grass',
        href: '{{ "/assets/css/theme-grass.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      grayscale: {
        label: 'Grayscale',
        href: '{{ "/assets/css/theme-grayscale.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      "harper": {
        label: 'Harper',
        href: '{{ "/assets/css/theme-harper.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      "horizon-bright": {
        label: 'Horizon Bright',
        href: '{{ "/assets/css/theme-horizon-bright.css" | prepend: site.baseurl }}',
        colorScheme: 'light',
      },
      "horizon-dark": {
        label: 'Horizon Dark',
        href: '{{ "/assets/css/theme-horizon-dark.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      "material": {
        label: 'Material',
        href: '{{ "/assets/css/theme-material.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      matrix: {
        label: 'Matrix',
        href: '{{ "/assets/css/theme-matrix.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      "mono-amber": {
        label: 'Mono Amber',
        href: '{{ "/assets/css/theme-mono-amber.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      "mono-cyan": {
        label: 'Mono Cyan',
        href: '{{ "/assets/css/theme-mono-cyan.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      "mono-green": {
        label: 'Mono Green',
        href: '{{ "/assets/css/theme-mono-green.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      "mono-red": {
        label: 'Mono Red',
        href: '{{ "/assets/css/theme-mono-red.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      "mono-white": {
        label: 'Mono White',
        href: '{{ "/assets/css/theme-mono-white.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      "mono-yellow": {
        label: 'Mono Yellow',
        href: '{{ "/assets/css/theme-mono-yellow.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      "tokyo-night": {
        label: 'Tokyo Night',
        href: '{{ "/assets/css/theme-tokyo-night.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      tron: {
        label: 'Tron',
        href: '{{ "/assets/css/theme-tron.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      },
      ubuntu: {
        label: 'Ubuntu',
        href: '{{ "/assets/css/theme-ubuntu.css" | prepend: site.baseurl }}',
        colorScheme: 'dark',
      }
    };

    function getStoredTheme() {
      try {
        return localStorage.getItem(storageKey);
      } catch (error) {
        return null;
      }
    }

    function persistTheme(themeName) {
      try {
        localStorage.setItem(storageKey, themeName);
      } catch (error) {
        /* Ignore storage failures and keep the theme for the current session. */
      }
    }

    function resolveTheme(themeName) {
      return Object.prototype.hasOwnProperty.call(themes, themeName) ? themeName : defaultTheme;
    }

    var root = document.documentElement;
    var activeTheme = resolveTheme(getStoredTheme());

    function ensureThemeStylesheet(theme) {
      var existingLink = document.getElementById('docs-theme-stylesheet');
      if (existingLink) {
        existingLink.href = theme.href;
        return existingLink;
      }

      var themeLink = document.createElement('link');
      themeLink.id = 'docs-theme-stylesheet';
      themeLink.rel = 'stylesheet';
      themeLink.href = theme.href;

      var head = document.head || document.getElementsByTagName('head')[0];
      if (head) {
        head.appendChild(themeLink);
      } else {
        document.addEventListener(
          'DOMContentLoaded',
          function () {
            var delayedHead = document.head || document.getElementsByTagName('head')[0];
            if (delayedHead && !document.getElementById('docs-theme-stylesheet')) {
              delayedHead.appendChild(themeLink);
            }
          },
          { once: true },
        );
      }

      return themeLink;
    }

    function applyTheme(themeName, shouldPersist) {
      activeTheme = resolveTheme(themeName);

      var theme = themes[activeTheme];
      ensureThemeStylesheet(theme);

      root.dataset.docsTheme = activeTheme;
      root.style.colorScheme = theme.colorScheme;

      if (shouldPersist) {
        persistTheme(activeTheme);
      }

      if (window.MBR_DOCS_THEME && typeof window.MBR_DOCS_THEME.onChange === 'function') {
        window.MBR_DOCS_THEME.onChange(activeTheme, theme);
      }
    }

    window.MBR_DOCS_THEME = {
      storageKey: storageKey,
      defaultTheme: defaultTheme,
      themes: themes,
      getTheme: function () {
        return activeTheme;
      },
      setTheme: function (themeName) {
        applyTheme(themeName, true);
      },
      onChange: null,
    };

    root.dataset.docsTheme = activeTheme;
    root.style.colorScheme = themes[activeTheme].colorScheme;

    ensureThemeStylesheet(themes[activeTheme]);
  })();
