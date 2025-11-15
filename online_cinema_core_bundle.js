(function () {
  'use strict';

  // Включаем режим TV
  Lampa.Platform.tv();

  // -------- Константы --------

  const STORAGE_UID_KEY    = 'lampac_unic_id';
  const STORAGE_EMAIL_KEY  = 'account_email';
  const STORAGE_PROXY_FLAG = 'proxy_tmdb';

  const TMDB_IMAGE_HOST = 'image.tmdb.org/';       // оригинальные картинки TMDB
  const TMDB_API_HOST   = 'api.themoviedb.org/3/'; // оригинальное API TMDB
  const PROXY_BASE      = 'https://lampa.maxvol.pro/tmdb/'; // базовый адрес прокси

  // -------- UID --------

  function ensureUid() {
    let uid = Lampa.Storage.get(STORAGE_UID_KEY, '');

    if (!uid) {
      uid = Lampa.Utils.uid(8).toLowerCase();
      Lampa.Storage.set(STORAGE_UID_KEY, uid);
    }

    return uid;
  }

  const uid = ensureUid();

  // -------- Общие параметры к URL --------

  function addCommonParams(url) {
    const utils = Lampa.Utils;

    // 1. account_email
    const email = Lampa.Storage.get(STORAGE_EMAIL_KEY, '');
    if (email && url.indexOf('account_email=') === -1) {
      url = utils.addUrlComponent(url, 'account_email=' + encodeURIComponent(email));
    }

    // 2. uid
    if (uid && url.indexOf('uid=') === -1) {
      url = utils.addUrlComponent(url, 'uid=' + encodeURIComponent(uid));
    }

    // 3. token (если понадобится — сюда можно подставить значение)
    const token = ''; // сейчас пусто, но логика уже есть
    if (token && url.indexOf('token=') === -1) {
      url = utils.addUrlComponent(url, 'token=' + encodeURIComponent(token));
    }

    return url;
  }

  // -------- Построение URL для TMDB --------

  function buildImageUrl(path) {
    const useProxy = !!Lampa.Storage.field(STORAGE_PROXY_FLAG);

    if (useProxy) {
      // через прокси
      return PROXY_BASE + 'img/' + addCommonParams(path);
    }

    // напрямую в TMDB
    return Lampa.Utils.protocol() + TMDB_IMAGE_HOST + path;
  }

  function buildApiUrl(path) {
    const useProxy = !!Lampa.Storage.field(STORAGE_PROXY_FLAG);

    if (useProxy) {
      // через прокси
      return PROXY_BASE + 'api/3/' + addCommonParams(path);
    }

    // напрямую в TMDB
    return Lampa.Utils.protocol() + TMDB_API_HOST + path;
  }

  // -------- Патчим Lampa.TMDB --------

  if (Lampa.TMDB) {
    Lampa.TMDB.image = buildImageUrl;
    Lampa.TMDB.api   = buildApiUrl;
  }

  // -------- UI: убираем блок "proxy" в настройках TMDB --------

  Lampa.Settings.listener.follow('open', function (event) {
    // имя секции может отличаться, но по исходнику, скорее всего, "tmdb"
    if (event.name === 'tmdb') {
      event.body
        .find('[data-parent="proxy"]')
        .remove();
    }
  });

})();

(function () {
  'use strict';

  const STORAGE_KEY = 'is_true_mobile';

  try {
    // Гарантируем, что Lampa доступна
    if (window.Lampa && Lampa.Storage && typeof Lampa.Storage.set === 'function') {
      // Принудительно отключаем мобильный режим
      Lampa.Storage.set(STORAGE_KEY, 'false');
    } else {
      console.warn('[not_mobile] Lampa.Storage недоступна');
    }
  } catch (e) {
    console.error('[not_mobile] Ошибка при установке режима:', e);
  }
})();

(function () {
  'use strict';

  // При необходимости принудительно переключаемся в режим TV
  if (Lampa && Lampa.Platform && typeof Lampa.Platform.tv === 'function') {
    Lampa.Platform.tv();
  }

  /**
   * Флаги включения фильтров (читаем/пишем в Storage)
   */
  const STATE = {
    asian_filter_enabled: false,
    language_filter_enabled: false,
    rating_filter_enabled: false,
    history_filter_enabled: false,
  };

  const STORAGE_KEYS = {
    asian: 'asian_filter_enabled',
    language: 'language_filter_enabled',
    rating: 'rating_filter_enabled',
    history: 'history_filter_enabled',
  };

  /**
   * Список азиатских языков (ISO 639-1), как в оригинальном коде
   */
  const ASIAN_LANGS = [
    'ja', 'ko', 'zh', 'th', 'vi', 'hi', 'ta', 'te', 'ml', 'kn', 'bn', 'ur',
    'pa', 'gu', 'mr', 'ne', 'si', 'my', 'km', 'lo', 'mn', 'ka', 'hy', 'az',
    'kk', 'ky', 'tg', 'tk', 'uz',
  ];

  /* ====================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ======================= */

  function loadState() {
    const S = Lampa.Storage;
    STATE.asian_filter_enabled = !!S.get(STORAGE_KEYS.asian, false);
    STATE.language_filter_enabled = !!S.get(STORAGE_KEYS.language, false);
    STATE.rating_filter_enabled = !!S.get(STORAGE_KEYS.rating, false);
    STATE.history_filter_enabled = !!S.get(STORAGE_KEYS.history, false);
  }

  function saveState(key, value) {
    STATE[key] = !!value;
    Lampa.Storage.set(STORAGE_KEYS[key.replace('_filter_enabled', '')] || key, !!value);
  }

  /**
   * Проверить, похоже ли это на «азиатский» контент
   * по original_language
   */
  function passAsianFilter(item) {
    if (!STATE.asian_filter_enabled) return true;
    if (!item || !item.original_language) return true;

    const lang = String(item.original_language).toLowerCase();
    return ASIAN_LANGS.indexOf(lang) === -1;
  }

  /**
   * Фильтр по языку: скрываем карточки, где название НЕ переведено
   * на язык по умолчанию (из Lampa.Storage.get('language'))
   */
  function passLanguageFilter(item) {
    if (!STATE.language_filter_enabled) return true;
    if (!item) return true;

    const lang = Lampa.Storage.get('language', 'ru');

    const title = item.title || item.name;
    const originalTitle = item.original_title || item.original_name;

    // Если оригинальный язык совпадает с системным — оставляем
    if (item.original_language === lang) return true;

    // Если язык не совпадает, но перевод названия есть (title != originalTitle) — оставляем
    if (item.original_language !== lang && originalTitle !== title) return true;

    // Иначе считаем, что карточка не переведена — скрываем
    return false;
  }

  /**
   * Фильтр по рейтингу: скрываем всё, что ниже 6.0,
   * кроме трейлеров, YouTube-видео и персон.
   */
  function passRatingFilter(item) {
    if (!STATE.rating_filter_enabled) return true;
    if (!item) return true;

    // Разрешаем трейлеры, видео и страницы персон
    const isVideo =
      item.media_type === 'video' ||
      item.type === 'Trailer' ||
      item.site === 'YouTube' ||
      (item.url && item.url.toLowerCase().indexOf('/person/') !== -1);

    if (isVideo) return true;

    if (!item.vote_average || item.vote_average === 0) return false;

    return item.vote_average >= 6;
  }

  /**
   * Фильтр по истории: скрываем законченное/выброшенное
   * Сильно упрощённая версия:
   *  - фильмы: если есть Activity с thrown или viewed — скрыть
   *  - сериалы: если все отслеживаемые эпизоды просмотрены — скрыть
   *
   * Оригинальный код гораздо сложнее и опирается на timetable + Timeline.
   * Здесь логика упрощена, но поведение останется удобным.
   */
  function passHistoryFilter(item) {
    if (!STATE.history_filter_enabled) return true;
    if (!item || !item.id) return true;

    // Получаем данные из Activity
    const historyInfo = Lampa.Activity.check(item) || {};

    // thrown — явно «выброшено / не интересно»
    if (historyInfo.thrown) return false;

    // Для фильмов — если есть просмотр (viewed / percent == 100), можно скрыть
    const mediaType = item.media_type || (item.seasons ? 'tv' : 'movie');

    if (mediaType === 'movie') {
      if (historyInfo.viewed || historyInfo.percent === 100) return false;
      return true;
    }

    // Для сериалов — грубая проверка:
    // если есть сезоны и по ним все эпизоды присутствуют в Timeline как 100%
    if (mediaType === 'tv' && Array.isArray(item.seasons) && item.seasons.length) {
      const allEpisodesWatched = checkAllEpisodesWatched(item);
      return !allEpisodesWatched;
    }

    return true;
  }

  /**
   * Проверка «все эпизоды просмотрены»
   * (упрощённый вариант оригинальной логики)
   */
  function checkAllEpisodesWatched(show) {
    try {
      const timetable = Lampa.Storage.get('timetable', '{}') || {};
      const itemTimetable = Array.isArray(timetable.history) ? timetable.history : [];
      const seasons = Array.isArray(show.seasons) ? show.seasons : [];

      // Собираем список эпизодов, которые уже вышли (по air_date)
      const airedEpisodes = [];

      seasons.forEach((season) => {
        if (!season || !season.season_number || !season.episode_count) return;
        if (!season.air_date || new Date(season.air_date) > new Date()) return;

        for (let ep = 1; ep <= season.episode_count; ep++) {
          airedEpisodes.push({
            season_number: season.season_number,
            episode_number: ep,
          });
        }
      });

      if (!airedEpisodes.length) return false;

      // Используем Timeline, чтобы проверить, есть ли 100% прогресс по каждой серии
      for (const ep of airedEpisodes) {
        const hash = Lampa.Timeline.hash([
          ep.season_number,
          ep.season_number > 10 ? ':' : '',
          ep.episode_number,
          show.original_title || show.original_name || show.name || show.title,
        ].join(''));

        const tl = Lampa.Timeline.get(hash);
        if (!tl || tl.percent === 0) {
          return false;
        }
      }

      return true;
    } catch (e) {
      console.error('[content_filter] error in checkAllEpisodesWatched:', e);
      return false;
    }
  }

  /**
   * Общий метод для применения всех фильтров к массиву results
   */
  function applyFilters(list) {
    if (!Array.isArray(list) || !list.length) return list;

    let out = Lampa.Arrays.clone(list);

    out = out.filter((item) => passAsianFilter(item));
    out = out.filter((item) => passLanguageFilter(item));
    out = out.filter((item) => passRatingFilter(item));
    out = out.filter((item) => passHistoryFilter(item));

    return out;
  }

  /**
   * Проверка, что URL — это обычный список из TMDB,
   * а не поиск и не персоналии.
   */
  function isContentListUrl(url) {
    if (!url) return false;
    const base = Lampa.TMDB.api('');
    return (
      url.indexOf(base) > -1 &&
      url.indexOf('/search') === -1 &&
      url.indexOf('/person/') === -1
    );
  }

  /* ======================= ЛОКАЛИЗАЦИЯ ======================== */

  function initTranslations() {
    Lampa.Lang.add({
      content_filters: {
        ru: 'Фильтр контента',
        en: 'Content Filter',
        uk: 'Фільтр контенту',
      },
      asian_filter: {
        ru: 'Убрать азиатский контент',
        en: 'Remove Asian Content',
        uk: 'Прибрати азіатський контент',
      },
      asian_filter_desc: {
        ru: 'Скрываем карточки азиатского происхождения',
        en: 'Hide cards of Asian origin',
        uk: 'Сховати картки азіатського походження',
      },
      language_filter: {
        ru: 'Убрать контент на другом языке',
        en: 'Remove Other Language Content',
        uk: 'Прибрати контент іншою мовою',
      },
      language_filter_desc: {
        ru: 'Скрываем карточки, названия которых не переведены на язык, выбранный по умолчанию',
        en: 'Hide cards not translated to the default language',
        uk: 'Сховати картки, які не перекладені на мову за замовчуванням',
      },
      rating_filter: {
        ru: 'Убрать низкорейтинговый контент',
        en: 'Remove Low-Rated Content',
        uk: 'Прибрати низько рейтинговий контент',
      },
      rating_filter_desc: {
        ru: 'Скрываем карточки с рейтингом ниже 6.0',
        en: 'Hide cards with a rating below 6.0',
        uk: 'Сховати картки з рейтингом нижче 6.0',
      },
      history_filter: {
        ru: 'Убрать просмотренный контент',
        en: 'Hide Watched Content',
        uk: 'Приховувати переглянуте',
      },
      history_filter_desc: {
        ru: 'Скрываем карточки фильмов и сериалов из истории, которые вы закончили смотреть',
        en: 'Hide cards from your viewing history that you have finished watching',
        uk: 'Сховати картки з вашої історії перегляду',
      },
    });
  }

  /* ======================= НАСТРОЙКИ ======================== */

  function initSettings() {
    const SettingsApi = Lampa.SettingsApi;
    const Lang = Lampa.Lang;

    // Добавляем компонент "Фильтр контента"
    SettingsApi.addComponent({
      component: 'content_filter_plugin',
      param: {
        name: 'content_filter_plugin',
        type: 'static',
        default: true,
      },
      field: {
        name: Lang.translate('content_filters'),
        description: 'Настройка отображения карточек по фильтрам',
      },
      onRender: function (item) {
        // Когда нажимаем "войти" — открываем настройки компонента
        item.on('hover:enter', function () {
          Lampa.Settings.open('content_filter_plugin');
          Lampa.Controller.enable('settings');
        });
      },
    });

    // Переключатель: азиатский контент
    SettingsApi.addParam({
      component: 'content_filter_plugin',
      param: {
        name: 'asian_filter_enabled',
        type: 'trigger',
        default: STATE.asian_filter_enabled,
      },
      field: {
        name: Lang.translate('asian_filter'),
        description: Lang.translate('asian_filter_desc'),
      },
      onChange: function (value) {
        saveState('asian_filter_enabled', value);
      },
    });

    // Переключатель: контент на другом языке
    SettingsApi.addParam({
      component: 'content_filter_plugin',
      param: {
        name: 'language_filter_enabled',
        type: 'trigger',
        default: STATE.language_filter_enabled,
      },
      field: {
        name: Lang.translate('language_filter'),
        description: Lang.translate('language_filter_desc'),
      },
      onChange: function (value) {
        saveState('language_filter_enabled', value);
      },
    });

    // Переключатель: рейтинг
    SettingsApi.addParam({
      component: 'content_filter_plugin',
      param: {
        name: 'rating_filter_enabled',
        type: 'trigger',
        default: STATE.rating_filter_enabled,
      },
      field: {
        name: Lang.translate('rating_filter'),
        description: Lang.translate('rating_filter_desc'),
      },
      onChange: function (value) {
        saveState('rating_filter_enabled', value);
      },
    });

    // Переключатель: история
    SettingsApi.addParam({
      component: 'content_filter_plugin',
      param: {
        name: 'history_filter_enabled',
        type: 'trigger',
        default: STATE.history_filter_enabled,
      },
      field: {
        name: Lang.translate('history_filter'),
        description: Lang.translate('history_filter_desc'),
      },
      onChange: function (value) {
        saveState('history_filter_enabled', value);
      },
    });
  }

  /* ======================= ПОДПИСКИ / ПЕРЕХВАТ ======================== */

  function initInterceptors() {
    // Перехватываем успешные запросы к TMDB и фильтруем results
    Lampa.Listener.follow('request_success', function (evt) {
      try {
        const params = evt.params || {};
        const data = evt.data || {};

        if (!isContentListUrl(params.url)) return;
        if (!data || !Array.isArray(data.results)) return;

        data.total_pages = data.results.length;
        data.results = applyFilters(data.results);
      } catch (e) {
        console.error('[content_filter] request_success handler error:', e);
      }
    });
  }

  /* ======================= ИНИЦИАЛИЗАЦИЯ ======================== */

  function init() {
    if (window.content_filter_plugin_initialized) return;
    window.content_filter_plugin_initialized = true;

    try {
      loadState();
      initTranslations();
      initSettings();
      initInterceptors();
      console.log('[content_filter] plugin initialized');
    } catch (e) {
      console.error('[content_filter] init error:', e);
      if (Lampa.Noty) {
        Lampa.Noty.show('Content Filter: ошибка инициализации');
      }
    }
  }

  if (window.appready) {
    init();
  } else {
    Lampa.Listener.follow('app', function (e) {
      if (e.type === 'appready') init();
    });
  }
})();

(function () {
    'use strict';

    function getCountryFlag(code) {
        if (!code || code.length !== 2) return '';
        return code.toUpperCase().split('').map(c =>
            String.fromCodePoint(127397 + c.charCodeAt(0))
        ).join('');
    }

    // Переводы стран (как у тебя, плюс можно расширять)
    const countryTranslations = {
        "US": "США",
        "CN": "Китай",
        "DE": "Германия",
        "FR": "Франция",
        "NL": "Нидерланды",
        "GB": "Великобритания",
        "CA": "Канада",
        "PL": "Польша",
        "UA": "Украина",
        "KZ": "Казахстан",
        "SE": "Швеция",
        "FI": "Финляндия",
        "NO": "Норвегия",
        "JP": "Япония",
        "SG": "Сингапур",
        "IT": "Италия",
        "ES": "Испания",
        "CH": "Швейцария",
        "AT": "Австрия",
        "BE": "Бельгия",
        "DK": "Дания",
        "IE": "Ирландия",
        "PT": "Португалия",
        "CZ": "Чехия",
        "RO": "Румыния",
        "HU": "Венгрия",
        "BG": "Болгария",
        "GR": "Греция",
        "TR": "Турция",
        "IL": "Израиль",
        "MX": "Мексика",
        "BR": "Бразилия",
        "AR": "Аргентина",
        "ZA": "Южная Африка",
        "NZ": "Новая Зеландия",
        "KR": "Южная Корея",
        "HK": "Гонконг",
        "AE": "ОАЭ",
        "RU": "Россия",
        "BY": "Беларусь",
        "LT": "Литва",
        "LV": "Латвия",
        "EE": "Эстония",
        "SI": "Словения",
        "HR": "Хорватия",
        "SK": "Словакия",
        "CY": "Кипр",
        "LU": "Люксембург",
        "IS": "Исландия",
        "MD": "Молдова",
        "PH": "Филиппины",
        "TH": "Таиланд",
        "VN": "Вьетнам",
        "MY": "Малайзия",
        "ID": "Индонезия",
        "IN": "Индия",
        "EG": "Египет",
        "NG": "Нигерия",
        "KE": "Кения",
        "CO": "Колумбия",
        "CL": "Чили",
        "PE": "Перу",
        "VE": "Венесуэла",
        "SA": "Саудовская Аравия",
        "QA": "Катар",
        "KW": "Кувейт",
        "OM": "Оман",
        "BA": "Босния и Герцеговина",
        "ME": "Черногория",
        "AL": "Албания",
        "MK": "Северная Македония",
        "GE": "Грузия",
        "AM": "Армения",
        "AZ": "Азербайджан",
        "IQ": "Ирак",
        "IR": "Иран",
        "PK": "Пакистан",
        "BD": "Бангладеш",
        "LK": "Шри-Ланка",
        "NP": "Непал",
        "KH": "Камбоджа",
        "LA": "Лаос",
        "MN": "Монголия",
        "UZ": "Узбекистан",
        "TJ": "Таджикистан",
        "KG": "Киргизия",
        "AF": "Афганистан",
        "SY": "Сирия",
        "LB": "Ливан",
        "JO": "Иордания",
        "TW": "Тайвань"
    };

    const ALLOWED_COUNTRY = 'RU'; // можно поменять или сделать массив разрешённых

    function showStyledLampaBanner(countryName, flag) {
        const existing = document.getElementById('vpn-warning');
        if (existing) existing.remove();

        const container = document.createElement('div');
        container.id = 'vpn-warning';
        Object.assign(container.style, {
            position: 'fixed',
            bottom: '80px',
            left: '50%',
            transform: 'translateX(-50%) translateY(20px)',
            background: '#202020',
            color: '#fff',
            padding: '15px 22px',
            fontFamily: 'Arial, sans-serif',
            maxWidth: '320px',
            borderRadius: '6.4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
            textAlign: 'center',
            zIndex: '9999',
            lineHeight: '1.4',
            opacity: '0',
            transition: 'opacity 0.4s ease, transform 0.4s ease',
            userSelect: 'none',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center'
        });

        const mainText = document.createElement('div');
        mainText.textContent = 'Отключите VPN';
        Object.assign(mainText.style, {
            fontWeight: '700',
            fontSize: '12.8px',
            marginBottom: '6.4px',
            display: 'block',
            width: '100%'
        });

        const subText = document.createElement('div');
        subText.textContent =
            `Вы подключены к сети: ${countryName} ${flag}\nОтключите VPN для стабильной работы.`;
        Object.assign(subText.style, {
            fontWeight: '400',
            fontSize: '11.2px',
            whiteSpace: 'pre-line',
            display: 'block',
            width: '100%'
        });

        container.appendChild(mainText);
        container.appendChild(subText);
        document.body.appendChild(container);

        requestAnimationFrame(() => {
            container.style.opacity = '1';
            container.style.transform = 'translateX(-50%) translateY(0)';
        });

        setTimeout(() => {
            container.style.opacity = '0';
            container.style.transform = 'translateX(-50%) translateY(20px)';
            setTimeout(() => container.remove(), 700);
        }, 7000);
    }

    function checkVPN() {
        // Важно: HTTPS, чтобы не словить блокировку mixed content
        fetch('https://ip-api.com/json/?fields=status,country,countryCode')
            .then(r => {
                if (!r.ok) throw new Error('Сетевая ошибка');
                return r.json();
            })
            .then(data => {
                if (data.status !== 'success') {
                    throw new Error('Не удалось получить Geodata');
                }

                const countryCode = data.countryCode || '';
                const countryName = countryTranslations[countryCode] || data.country || '';
                const flag = getCountryFlag(countryCode);

                console.log(`[VPN Plugin] Страна: ${countryName} (${countryCode})`);

                if (countryCode !== ALLOWED_COUNTRY) {
                    showStyledLampaBanner(countryName, flag);
                } else {
                    console.log('[VPN Plugin] IP в разрешённой стране — всё ок');
                }
            })
            .catch(err => {
                console.log('[VPN Plugin] Ошибка получения IP:', err);
            });
    }

    function init() {
        if (!window.Lampa) {
            console.log('[VPN Plugin] Lampa не загружена');
            return;
        }

        // Чтобы не дёргать API каждый раз при перезапуске экрана
        if (sessionStorage.getItem('vpn-check-done')) {
            return;
        }
        sessionStorage.setItem('vpn-check-done', '1');

        checkVPN();
    }

    if (window.appready) {
        init();
    } else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'appready') init();
        });
    } else {
        // fallback — на случай, если скрипт подключён очень рано
        window.addEventListener('load', init);
    }
})();

(function () {
    'use strict';

    // Включаем TV-режим (как в оригинале)
    Lampa.Platform.tv();

    function initCardify() {

        // ❌ Полностью убрана проверка на bylampa
        // ❌ Полностью убрана ошибка доступа

        // Разрешаем работу только в TV-интерфейсе
        if (!Lampa.Platform.get('tv')) {
            console.log('Cardify', 'no tv');
            return;
        }

        // CSS-шаблон (сюда нужно вставить содержимое cardify_css)
        const CARDIFY_CSS = `
<style>
  /* сюда вставляется CSS из cardify_css */
</style>`;

        // HTML-шаблон фулл-старта (сюда вставляешь свой full_start_new HTML)
        const FULL_START_TEMPLATE = `
<div class="full-start-new cardify">
    <!-- сюда вставляется исходный markup full_start_new -->
</div>`;

        // Регистрируем шаблоны
        Lampa.Template.add('cardify_css', CARDIFY_CSS, true);
        Lampa.Template.add('full_start_new', FULL_START_TEMPLATE, true);

        // Вставляем стили в body
        $('body').append(Lampa.Template.get('cardify_css', {}, true));

        // Подключаем оформление full-экрана
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite') {
                e.object
                    .render()
                    .find('.full-start__background')
                    .addClass('cardify__background');
            }
        });
    }

    // Старт после загрузки приложения
    if (window.appready) {
        initCardify();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'appready') initCardify();
        });
    }
})();

// === КАСТОМНЫЕ НАСТРОЙКИ LAMPA — ПОВЕРХ ВСЕГО, ЧТО В СКРИПТЕ ВЫШЕ ===
(function () {
    'use strict';

    // Базовый объект настроек
    window.lampa_settings = window.lampa_settings || {};

    // 1. ГЛОБАЛЬНЫЕ ФЛАГИ ПРИЛОЖЕНИЯ
    Object.assign(window.lampa_settings, {
        // не используем socket (как в твоём коде)
        socket_use: false,

        // аккаунт – выключен, чтобы ничего лишнего не лезло
        account_use: false,

        // включены торренты
        torrents_use: true,

        // язык из настроек
        lang_use: true,

        // история, фавориты и т.п. – включены
        history_use: true,
        bookmarks_use: true,

        // пуш-состояние (чтобы можно было нормально ходить по истории)
        push_state: true,
    });

    // 2. ПЛАГИНЫ / ФУНКЦИИ (dmca, реклама, ai и прочее)
    window.lampa_settings.plugins = Object.assign(
        {
            // DMCA-режим выключен
            dmca: false,

            // Реклама вырублена
            ads: false,

            // Искуственный интеллект – включён
            ai: true,

            // Торренты и «жёсткий» контент доступны
            torrents: true,
            adult: true,

            // Аналитика / трекинг — по вкусу, тут выключил
            analytics: false,
        },
        window.lampa_settings.plugins || {}
    );

    // 3. ЧИСТКА ИНТЕРФЕЙСА: убираем баннеры, премиумы, чёрные пятницы и т.п.
    function cleanUi(root) {
        const rootNode = root || document;

        // Чёрная пятница, промо-баннеры, премиум-блоки
        [
            '.black-friday__button',
            '.black-friday',
            '.promo-banner',
            '.cub-premium',
            '.premium-banner',
            '.ads-banner',
        ].forEach(sel => {
            rootNode.querySelectorAll(sel).forEach(el => el.remove());
        });

        // Кнопки/пункты меню «CUB Premium», «Premium», «Подписка» и т.п.
        Array.from(rootNode.querySelectorAll('*')).forEach(el => {
            const txt = (el.textContent || '').trim();
            if (!txt) return;

            if (
                /CUB\s*Premium/i.test(txt) ||
                /Premium/i.test(txt) ||
                /Подписка/i.test(txt) ||
                /Премиум/i.test(txt)
            ) {
                // убираем целый пункт меню / карточку
                if (el.closest('.menu__item, .selector, .card, li, .settings-param')) {
                    el.closest('.menu__item, .selector, .card, li, .settings-param').remove();
                } else {
                    el.remove();
                }
            }
        });
    }

    // 4. Наблюдатель за DOM – чистим, когда что-то подгружается
    const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                    cleanUi(node);
                }
            });
        });
    });

    if (document.body) {
        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
        // стартовая чистка
        cleanUi(document);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
            cleanUi(document);
        });
    }

    // 5. Дополнительно: когда открываются настройки / главное меню – ещё раз подчистить
    if (window.Lampa && Lampa.Listener && Lampa.Listener.follow) {
        // реакция на событие приложения
        Lampa.Listener.follow('app', e => {
            if (e.type === 'ready' || e.type === 'activity') {
                cleanUi(document);
            }
        });

        // реакция на открытие настроек
        if (Lampa.Settings && Lampa.Settings.listener && Lampa.Settings.listener.follow) {
            Lampa.Settings.listener.follow('open', e => {
                if (e.name === 'main' || e.name === 'server' || e.name === 'account') {
                    setTimeout(() => cleanUi(document), 300);
                }
            });
        }
    }
})();

(function () {
    'use strict';

    // Включаем ТВ-платформу
    Lampa.Platform.tv();

    /**
     * Панель информации слева/справа (заголовок, детали, описание)
     */
    function InfoPanel() {
        const network = new Lampa.Reguest();
        const cache = {};
        let $root;
        let timerLoad;

        this.create = function () {
            const html = `
                <div class="new-interface-info">
                    <div class="new-interface-info__body">
                        <div class="new-interface-info__head"></div>
                        <div class="new-interface-info__title"></div>
                        <div class="new-interface-info__details"></div>
                        <div class="new-interface-info__description"></div>
                    </div>
                </div>
            `;
            $root = $(html);
        };

        /**
         * Обновить панель по базовым данным карточки
         */
        this.update = function (item) {
            if (!$root) return;

            // Заголовок или логотип
            const $title = $root.find('.new-interface-info__title');
            const showLogo = Lampa.Storage.get('desc') !== false; // настройка "Логотип вместо названия"

            if (showLogo && item.id) {
                const type = item.name ? 'tv' : 'movie';
                const apiKey = Lampa.TMDB.key();
                const lang = Lampa.Storage.get('language');
                const url = Lampa.TMDB.api(`${type}/${item.id}/images?api_key=${apiKey}&language=${lang}`);

                $.get(url, function (res) {
                    if (res && res.logos && res.logos[0] && res.logos[0].file_path) {
                        const path = res.logos[0].file_path.replace('.svg', '.png');
                        const logoUrl = Lampa.TMDB.image('t/p/w500' + path);

                        $title.html(
                            `<img style="margin-top:0.3em;margin-bottom:0.1em;max-height:2.8em;max-width:6.8em;" src="${logoUrl}" />`
                        );
                    } else {
                        $title.text(item.title || item.name || '');
                    }
                });
            } else {
                $title.text(item.title || item.name || '');
            }

            // Описание (если включено)
            const showDescription = Lampa.Storage.get('new_interface_show_desc') !== false;
            const $desc = $root.find('.new-interface-info__description');
            if (showDescription) {
                $desc.text(item.overview || Lampa.Lang.translate('full_notext'));
            } else {
                $desc.text('');
            }

            // Фон
            if (item.backdrop_path) {
                const bg = Lampa.Api.img(item.backdrop_path, 'w1280');
                Lampa.Layer.update(bg);
            }

            // Загрузить дополнительные данные (рейтинг, жанры, сезоны и т.п.)
            this.loadFullInfo(item);
        };

        /**
         * Собрать строку деталей (год, страны, жанры, рейтинг, время, статусы и т.п.)
         */
        this.draw = function (full) {
            if (!$root) return;

            const year =
                (full.release_date || full.first_air_date || '0000').toString().slice(0, 4) || '0000';
            const rating = parseFloat((full.vote_average || 0) + '').toFixed(1);
            const headerParts = [];
            const detailParts = [];

            // HEADER: год + страны
            if (year !== '0000') {
                headerParts.push(`С ${year}`);
            }

            const countries = Lampa.Api.tmdb.parseCountries(full);
            if (countries.length) {
                headerParts.push(countries.join(', '));
            }

            // RATING
            const showRating = Lampa.Storage.get('rat') !== false;
            if (showRating && rating > 0) {
                detailParts.push(
                    `<div class="full-start__rate"><div>${rating}</div><div>TMDB</div></div>`
                );
            }

            // ЖАНРЫ
            const showGenres = Lampa.Storage.get('ganr') !== false;
            if (showGenres && full.genres && full.genres.length) {
                const genres = full.genres
                    .map(g => Lampa.Utils.capitalizeFirstLetter(g.name))
                    .join(', ');
                detailParts.push(genres);
            }

            // ВРЕМЯ
            const showRuntime = Lampa.Storage.get('vremya') !== false;
            if (showRuntime && full.runtime) {
                const t = Lampa.Utils.secondsToTime(full.runtime * 60, true);
                detailParts.push(`<span class="full-start__pg">${t}</span>`);
            }

            // СЕЗОНЫ
            const showSeasons = Lampa.Storage.get('seas') !== false;
            if (showSeasons && full.number_of_seasons) {
                detailParts.push(
                    `<span class="full-start__pg" style="font-size:0.9em;">Сезонов ${full.number_of_seasons}</span>`
                );
            }

            // ЭПИЗОДЫ
            const showEpisodes = Lampa.Storage.get('eps') !== false;
            if (showEpisodes && full.number_of_episodes) {
                detailParts.push(
                    `<span class="full-start__pg" style="font-size:0.9em;">Эпизодов ${full.number_of_episodes}</span>`
                );
            }

            // ВОЗРАСТНОЕ ОГРАНИЧЕНИЕ
            const showAge = Lampa.Storage.get('year_ogr') !== false;
            if (showAge) {
                const age = Lampa.Api.tmdb.parsePG(full);
                if (age) {
                    detailParts.push(
                        `<span class="full-start__pg">${age}</span>`
                    );
                }
            }

            // СТАТУС
            const showStatus = Lampa.Storage.get('status') !== false;
            if (showStatus && full.status) {
                let statusText = '';
                switch (full.status.toLowerCase()) {
                    case 'released':
                        statusText = 'Выпущенный';
                        break;
                    case 'ended':
                        statusText = 'Закончен';
                        break;
                    case 'returning series':
                        statusText = 'Онгоинг';
                        break;
                    case 'in production':
                        statusText = 'В производстве';
                        break;
                    case 'post production':
                        statusText = 'Скоро';
                        break;
                    case 'planned':
                        statusText = 'Запланировано';
                        break;
                    default:
                        statusText = full.status;
                }
                if (statusText) {
                    detailParts.push(
                        `<span class="full-start__status" style="font-size:0.9em;">${statusText}</span>`
                    );
                }
            }

            // Вставляем в DOM
            $root.find('.new-interface-info__head').empty().text(headerParts.join(' | '));
            $root.find('.new-interface-info__details').empty().html(detailParts.join('<span class="new-interface-info__split">&#9679;</span>'));
        };

        /**
         * Загрузка полных данных из TMDB
         */
        this.loadFullInfo = function (item) {
            const self = this;
            clearTimeout(timerLoad);

            const type = item.name ? 'tv' : 'movie';
            const apiKey = Lampa.TMDB.key();
            const lang = Lampa.Storage.get('language') || 'ru-RU';

            const url = Lampa.TMDB.api(
                `${type}/${item.id}?api_key=${apiKey}&append_to_response=content_ratings,release_dates&language=${lang}`
            );

            if (cache[url]) {
                self.draw(cache[url]);
                return;
            }

            timerLoad = setTimeout(function () {
                network.clear();
                network.timeout(5000);

                network.silent(url, function (data) {
                    cache[url] = data;
                    self.draw(data);
                });
            }, 300);
        };

        this.render = function () {
            return $root;
        };

        this.destroy = function () {
            if ($root) $root.remove();
            $root = null;
        };
    }

    /**
     * Новый интерфейс InteractionMain
     */
    function NewInteractionMain(source) {
        const scroll = new Lampa.Scroll({
            mask: true,
            over: true,
            scroll_by_item: true
        });

        const cards = [];
        const $root = $('<div class="new-interface"><img class="full-start__background"></div>');
        const $bg = $root.find('.full-start__background');

        let index = 0;
        let itemsCache = null;
        let infoPanel = null;
        let bgUrl = '';
        let bgTimer;

        this.activity = new Lampa.Activity();
        this.loading = false;
        this.next = null; // будет задано Lampa самим

        this.create = function () {
            // ничего особенного, всё дальше в start()
        };

        this.start = function () {
            const self = this;

            infoPanel = new InfoPanel();
            infoPanel.create();

            // Выводим первые элементы
            if (itemsCache) {
                itemsCache.slice(0, 2).forEach(self.append.bind(self));
            }

            scroll.minus(infoPanel.render());
            $root.append(infoPanel.render());
            $root.append(scroll.render());

            // Контроллер
            Lampa.Controller.add('interaction_main_new', {
                link: this,
                toggle: function () {
                    if (self.activity.canRefresh()) return false;
                    if (cards.length) cards[index].toggle();
                },
                update: function () {},
                left: function () {
                    Lampa.Controller.toggle('menu');
                },
                right: function () {
                    Lampa.Controller.toggle('content');
                },
                up: function () {
                    Lampa.Activity.back();
                },
                down: function () {
                    // Пусто — вниз по линиям не двигаемся, всё в пределах списка
                },
                back: function () {
                    Lampa.Activity.back();
                }
            });

            Lampa.Controller.toggle('interaction_main_new');
            this.activity.loader(false);
            this.activity.canRefresh(false);
        };

        /**
         * Коллбек от источника — передаём сюда ленту карточек
         */
        this.build = function (items) {
            itemsCache = items;

            infoPanel = new InfoPanel();
            infoPanel.create();

            scroll.minus(infoPanel.render());
            items.slice(0, 2).forEach(this.append.bind(this));

            $root.append(infoPanel.render());
            $root.append(scroll.render());

            this.activity.loader(false);
            this.activity.canRefresh(false);
        };

        this.append = function (item) {
            const self = this;
            if (item.ready) return;
            item.ready = true;

            const line = new Lampa.InteractionLine(item, {
                url: item.url,
                card_small: true,
                cardClass: item.cardClass,
                genres: source.genres,
                object: source,
                card_wide: Lampa.Storage.field('wide_post'),
                nomore: item.nomore
            });

            line.create();

            line.onDown = self.down.bind(self);
            line.onUp = self.up.bind(self);
            line.onBack = self.back.bind(self);

            line.onToggle = function () {
                index = cards.indexOf(line);
            };

            line.onFocus = function (data) {
                if (infoPanel) infoPanel.update(data);
                self.background(data);
            };

            line.onFocusMore = function (data) {
                if (infoPanel) infoPanel.update(data);
                self.background(data);
            };

            scroll.append(line.render());
            cards.push(line);
        };

        this.background = function (item) {
            if (!item.backdrop_path) return;

            const newUrl = Lampa.Api.img(item.backdrop_path, 'w1280');
            if (newUrl === bgUrl) return;

            clearTimeout(bgTimer);
            bgTimer = setTimeout(function () {
                $bg.addClass('visible');
                $bg[0].onload = function () {
                    $bg.addClass('visible');
                };
                $bg[0].onerror = function () {
                    $bg.removeClass('visible');
                };

                bgUrl = newUrl;
                setTimeout(function () {
                    $bg[0].src = bgUrl;
                }, 50);
            }, 100);
        };

        this.down = function () {
            index++;
            index = Math.min(index, cards.length - 1);

            cards[index].toggle();
            scroll.update(cards[index].render());

            // подгрузка следующей пачки, если реализована this.next
            if (this.next && !this.loading && itemsCache && cards.length < itemsCache.length) {
                this.loading = true;
                this.next(function (nextItems) {
                    nextItems.forEach(this.append.bind(this));
                    this.loading = false;
                }.bind(this), function () {
                    this.loading = false;
                }.bind(this));
            }
        };

        this.up = function () {
            index--;
            if (index < 0) {
                index = 0;
                Lampa.Activity.back();
            } else {
                cards[index].toggle();
                scroll.update(cards[index].render());
            }
        };

        this.back = function () {
            Lampa.Activity.back();
        };

        this.render = function () {
            return $root;
        };

        this.pause = function () {};
        this.refresh = function () {
            this.activity.loader(true);
            this.activity.need_refresh = true;
        };
        this.destroy = function () {
            scroll.destroy();
            if (infoPanel) infoPanel.destroy();
            $root.remove();
        };
    }

    /**
     * Подмена стандартного InteractionMain
     */
    function initInteractionOverride() {
        const OriginalInteractionMain = Lampa.InteractionMain;

        Lampa.InteractionMain = function (source) {
            let Impl = NewInteractionMain;

            // Ограничения: маленький экран, старая версия, мобильный – старый интерфейс
            if (window.innerWidth < 0x2ff) Impl = OriginalInteractionMain;
            if (Lampa.Manifest.runtime < 0x99) Impl = OriginalInteractionMain;
            if (Lampa.Platform.screen('mobile')) Impl = OriginalInteractionMain;
            if (source.name === 'tmdb') Impl = OriginalInteractionMain;

            return new Impl(source);
        };
    }

    /**
     * Стили для нового интерфейса
     */
    function injectStyles() {
        const css = `
            <style>
            .new-interface .card--small.card--wide {
                width: 18.3em;
            }

            .new-interface-info {
                position: relative;
                padding: 1.5em;
                height: 26em;
            }

            .new-interface-info__body {
                width: 80%;
                padding-top: 1.1em;
            }

            .new-interface-info__head {
                color: rgba(255,255,255,0.6);
                margin-bottom: 1em;
                font-size: 1.3em;
                min-height: 1em;
            }

            .new-interface-info__head span {
                color: #fff;
            }

            .new-interface-info__title {
                font-size: 4em;
                font-weight: 600;
                margin-bottom: 0.3em;
                overflow: hidden;
                text-overflow: ellipsis;
                display: -webkit-box;
                -webkit-line-clamp: 1;
                line-clamp: 1;
                -webkit-box-orient: vertical;
                margin-left: -0.03em;
                line-height: 1.3;
            }

            .new-interface-info__details {
                margin-bottom: 1.6em;
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                min-height: 1.9em;
                font-size: 1.3em;
            }

            .new-interface-info__split {
                margin: 0 1em;
                font-size: 0.7em;
            }

            .new-interface-info__description {
                font-size: 1.4em;
                font-weight: 310;
                line-height: 1.3;
                overflow: hidden;
                text-overflow: ellipsis;
                display: -webkit-box;
                -webkit-line-clamp: 3;
                line-clamp: 3;
                -webkit-box-orient: vertical;
                width: 65%;
            }

            .new-interface .card-more__box {
                padding-bottom: 95%;
            }

            .new-interface .full-start__background {
                position: absolute;
                left: 0;
                right: 0;
                height: 108%;
                top: -5em;
                object-fit: cover;
                opacity: 0.2;
            }

            .new-interface .full-start__rate {
                font-size: 1.3em;
                margin-right: 0;
            }

            .new-interface .card__promo {
                display: none;
            }

            .new-interface .card.card--wide + .card-more .card-more__box {
                padding-bottom: 95%;
            }

            .new-interface .card.card--wide .card-watched {
                display: none !important;
            }

            body.light--version .new-interface-info__body {
                width: 69%;
                padding-top: 1.5em;
            }

            body.light--version .new-interface-info {
                height: 25.3em;
            }
            </style>
        `;

        $('head').append($(css));
    }

    /**
     * Настройки
     */
    function initSettings() {
        // Компонент "Настройки элементов"
        Lampa.SettingsApi.addComponent({
            component: 'style_interface',
            name: 'Настройки элементов',
            onRender: function (item) {
                item.on('hover:enter', function () {
                    Lampa.Settings.create('style_interface');
                    const controller = Lampa.Controller.active().controller;
                    controller.onBack = function () {
                        Lampa.Settings.create('settings');
                    };
                });
            }
        });

        // Основной триггер "Стильный интерфейс"
        Lampa.SettingsApi.addParam({
            component: 'settings',
            param: {
                name: 'new_interface',
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Стильный интерфейс'
            }
        });

        // Широкие постеры
        Lampa.SettingsApi.addParam({
            component: 'style_interface',
            param: {
                name: 'wide_post',
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Широкие постеры'
            }
        });

        // Логотип вместо названия
        Lampa.SettingsApi.addParam({
            component: 'style_interface',
            param: {
                name: 'desc',
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Логотип вместо названия'
            }
        });

        // Показывать описание (свой ключ, чтобы не путать с desc)
        Lampa.SettingsApi.addParam({
            component: 'style_interface',
            param: {
                name: 'new_interface_show_desc',
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Показывать описание'
            }
        });

        // Статус
        Lampa.SettingsApi.addParam({
            component: 'style_interface',
            param: {
                name: 'status',
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Показывать статус фильма/сериала'
            }
        });

        // Кол-во сезонов
        Lampa.SettingsApi.addParam({
            component: 'style_interface',
            param: {
                name: 'seas',
                type: 'trigger',
                default: false
            },
            field: {
                name: 'Показывать количество сезонов'
            }
        });

        // Кол-во эпизодов
        Lampa.SettingsApi.addParam({
            component: 'style_interface',
            param: {
                name: 'eps',
                type: 'trigger',
                default: false
            },
            field: {
                name: 'Показывать количество эпизодов'
            }
        });

        // Возраст
        Lampa.SettingsApi.addParam({
            component: 'style_interface',
            param: {
                name: 'year_ogr',
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Показывать возрастное ограничение'
            }
        });

        // Время фильма
        Lampa.SettingsApi.addParam({
            component: 'style_interface',
            param: {
                name: 'vremya',
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Показывать время фильма'
            }
        });

        // Жанр
        Lampa.SettingsApi.addParam({
            component: 'style_interface',
            param: {
                name: 'ganr',
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Показывать жанр фильма'
            }
        });

        // Рейтинг
        Lampa.SettingsApi.addParam({
            component: 'style_interface',
            param: {
                name: 'rat',
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Показывать рейтинг фильма'
            }
        });
    }

    // Инициализация, когда Lampa готов
    function init() {
        if (typeof Lampa === 'undefined') return;

        // если выключен параметр – не подменяем интерфейс
        if (Lampa.Storage.get('new_interface') === 'false') return;

        injectStyles();
        initSettings();
        initInteractionOverride();
    }

    // Ожидаем, пока Lampa поднимется
    const interval = setInterval(function () {
        if (typeof Lampa !== 'undefined') {
            clearInterval(interval);
            init();
        }
    }, 200);
})();


