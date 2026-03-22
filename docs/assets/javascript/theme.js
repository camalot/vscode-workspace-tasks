---
---

  (function () {
    'use strict';

    function initThemeDropdown() {
      var themeConfig = window.MBR_DOCS_THEME;
      if (!themeConfig) return;

      /* Try to find the sidebar nav first */
      var siteNav = document.querySelector('nav#site-nav');
      var themeMount = null;
      var navHost = null;

      if (siteNav) {
        /* Insert before the ul.nav-list in the sidebar */
        var navList = siteNav.querySelector('ul.nav-list');
        if (navList) {
          themeMount = document.createElement('div');
          themeMount.className = 'mbr-docs-theme-nav-item';
          siteNav.insertBefore(themeMount, navList);
        }
      }

      /* Fallback to aux-nav-list if sidebar approach didn't work */
      if (!themeMount) {
        navHost = document.querySelector('.aux-nav-list');
        if (navHost) {
          themeMount = document.createElement('li');
          themeMount.className = 'aux-nav-list-item mbr-docs-theme-nav-item';
          navHost.appendChild(themeMount);
        }
      }

      /* Fallback to main header */
      if (!themeMount) {
        navHost = document.querySelector('.main-header') ||
          document.querySelector('header') ||
          document.querySelector('[role="banner"]');
        if (navHost) {
          themeMount = document.createElement('div');
          themeMount.className = 'mbr-docs-theme-nav-item';
          navHost.appendChild(themeMount);
        }
      }

      if (themeMount) {
        var themeEntries = Object.keys(themeConfig.themes);
        var menuId = 'mbr-docs-theme-menu';

        var dropdownHTML = [
          '<div class="dropdown">',
          '  <button class="btn btn-sm btn-outline-secondary dropdown-toggle mbr-docs-theme-trigger" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-controls="' +
          menuId +
          '" title="Select theme">',
          '    <span class="mbr-docs-theme-trigger-label">Theme</span>',
          '    <span class="mbr-docs-theme-trigger-value"></span>',
          '  </button>',
          '  <ul class="dropdown-menu dropdown-menu-end mbr-docs-theme-menu" id="' + menuId + '">',
          themeEntries
            .map(function (themeName) {
              var theme = themeConfig.themes[themeName];
              return (
                '    <li><button class="dropdown-item mbr-docs-theme-option" type="button" data-docs-theme-option="' +
                themeName +
                '" tabindex="0">' +
                '<span>' +
                theme.label +
                '</span>' +
                '<i class="bi bi-check2 mbr-docs-theme-option-check" aria-hidden="true"></i>' +
                '</button></li>'
              );
            })
            .join(''),
          '  </ul>',
          '</div>',
        ].join('\n');

        themeMount.innerHTML = dropdownHTML;

        var trigger = themeMount.querySelector('.mbr-docs-theme-trigger');
        var triggerValue = themeMount.querySelector('.mbr-docs-theme-trigger-value');
        var themeOptions = themeMount.querySelectorAll('[data-docs-theme-option]');
        var previousOnChange = themeConfig.onChange;

        function updateThemeUi(themeName) {
          var activeTheme = themeConfig.themes[themeName] || themeConfig.themes[themeConfig.defaultTheme];
          triggerValue.textContent = activeTheme.label;
          trigger.setAttribute('aria-label', 'Theme: ' + activeTheme.label);

          themeOptions.forEach(function (option) {
            var isActive = option.getAttribute('data-docs-theme-option') === themeName;
            option.classList.toggle('active', isActive);
            option.setAttribute('aria-current', isActive ? 'true' : 'false');
          });
        }

        themeOptions.forEach(function (option) {
          option.addEventListener('click', function () {
            themeConfig.setTheme(option.getAttribute('data-docs-theme-option'));
          });
        });

        themeConfig.onChange = function (themeName, theme) {
          if (typeof previousOnChange === 'function') {
            previousOnChange(themeName, theme);
          }

          updateThemeUi(themeName);
        };

        updateThemeUi(themeConfig.getTheme());
      }
    }

    /* Initialize theme dropdown when DOM is ready */
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initThemeDropdown);
    } else {
      initThemeDropdown();
    }

    var fab = document.getElementById('back-to-top-fab');
    if (!fab) {
      return;
    }

    window.addEventListener(
      'scroll',
      function () {
        if (window.scrollY > 300) {
          fab.classList.add('visible');
        } else {
          fab.classList.remove('visible');
        }
      },
      { passive: true },
    );

    fab.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  })();
