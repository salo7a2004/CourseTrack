/* =====================================================================
   COURSETRACK — SHARED CORE (loaded by BOTH index.html and admin.html)
   ---------------------------------------------------------------------
   Load order on both pages:
       config.js  ->  i18n.js  ->  common.js  ->  student.js | admin.js

   Everything the two portals must do identically lives here, once, so it
   cannot drift apart:

     CourseTrack.firebase  one REST client: a timeout that covers the WHOLE
                           request, retries for transient failures, typed
                           errors, and one place that turns an error into
                           a user-facing toast.
     CourseTrack.toast     accessible, translated, de-duplicated alerts.
     CourseTrack.ui        theme, logos, brand colours, loader, escaping.
     (safety net)          unhandled promise rejections / script errors are
                           logged and surfaced as one friendly toast instead
                           of failing silently.

   The only globals the project creates are APP_CONFIG, I18N and
   CourseTrack. Nothing here ever logs a request URL (it can carry the
   admin secret) or any student data.
   ===================================================================== */

(() => {
  'use strict';

  const I18N = window.I18N;
  if (!I18N) {
    console.error('CourseTrack — common.js needs i18n.js loaded first; the portal cannot start.');
    return;
  }

  const KEYS = Object.freeze({ THEME: 'coursetrack_theme' });

  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const sleep = (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); });

  /* =====================================================================
     UI HELPERS (previously duplicated — and slowly diverging — in both
     student.js and admin.js)
     ===================================================================== */

  /** Escapes text for use as HTML *content* (&, <, >). Use escapeAttr for attributes. */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /** Escapes text for use inside a double-quoted HTML attribute. */
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  /** config.js `colors` -> CSS custom properties on <html>. */
  function applyBrandColors(config) {
    const colors = config && config.colors;
    if (!colors) return;
    const root = document.documentElement.style;
    if (colors.primary) root.setProperty('--color-primary', colors.primary);
    if (colors.secondary) root.setProperty('--color-accent', colors.secondary);
  }

  /** Only ever reveals a logo <img> once it has actually finished loading; a
   *  missing path or a failed load leaves the clean text placeholder visible
   *  instead of a broken-image icon. */
  function applyLogo(imgEl, placeholderEl, path) {
    if (!imgEl) return;
    imgEl.hidden = true;
    if (placeholderEl) placeholderEl.hidden = false;
    if (!path) return;

    imgEl.onload = () => { imgEl.hidden = false; if (placeholderEl) placeholderEl.hidden = true; };
    imgEl.onerror = () => {
      console.warn(`CourseTrack — logo failed to load from "${path}"; showing placeholder instead.`);
      imgEl.hidden = true;
      imgEl.removeAttribute('src');
      if (placeholderEl) placeholderEl.hidden = false;
    };
    imgEl.src = path;
  }

  function hideLoadingScreen(el) {
    if (!el || el.style.display === 'none') return;
    el.classList.add('is-hidden');
    window.setTimeout(() => { el.style.display = 'none'; }, 650);
  }

  /** Light Mode is always the default; the choice is shared by both portals. */
  const theme = {
    apply(value) {
      document.documentElement.setAttribute('data-theme', value);
      try { window.localStorage.setItem(KEYS.THEME, value); } catch (err) { /* storage blocked: non-fatal */ }
    },
    init() {
      let saved = null;
      try { saved = window.localStorage.getItem(KEYS.THEME); } catch (err) { /* storage blocked: non-fatal */ }
      theme.apply(saved === 'dark' ? 'dark' : 'light');
    },
    current() {
      return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    },
    toggle() {
      theme.apply(theme.current() === 'dark' ? 'light' : 'dark');
    },
  };

  /* =====================================================================
     TOASTS
     ---------------------------------------------------------------------
     CourseTrack.toast.show({
       kind: 'error' | 'warning' | 'info' | 'success',
       titleKey / title,            dictionary key (re-translates on a language
       messageKey / message,        switch) or already-final text
       vars,                        values for {placeholders} in the keys
       action: { labelKey, onClick },   e.g. a "Try again" button
       duration,                    ms; 0 = stays until dismissed
       id,                          same id = replaces instead of stacking
     })
     ===================================================================== */
  const toast = (() => {
    const MAX_VISIBLE = 3;
    const DEFAULT_MS = { error: 10000, warning: 9000, info: 6000, success: 5000 };
    const svg = (paths) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    const ICONS = {
      error: svg('<circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/>'),
      warning: svg('<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
      info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
      success: svg('<circle cx="12" cy="12" r="10"/><path d="M8 12.5l3 3 5-6"/>'),
    };
    const CLOSE_ICON = svg('<path d="M18 6L6 18M6 6l12 12"/>');

    const live = new Map();   // id -> { el, timer, remaining, started }
    let region = null;
    let counter = 0;

    function getRegion() {
      if (region && region.isConnected) return region;
      region = document.createElement('div');
      region.id = 'toast-region';
      region.className = 'toast-region';
      region.setAttribute('role', 'region');
      region.setAttribute('data-i18n-aria', 'toast.region');
      document.body.appendChild(region);
      I18N.apply(region);
      return region;
    }

    function fillLine(el, key, vars, raw) {
      if (key) I18N.setText(el, key, vars);
      else I18N.setRaw(el, raw === undefined || raw === null ? '' : String(raw));
    }

    function remove(id, options) {
      const record = live.get(id);
      if (!record) return;
      live.delete(id);
      window.clearTimeout(record.timer);
      const done = () => { if (record.el.parentNode) record.el.remove(); };
      if ((options && options.immediate) || reducedMotion()) { done(); return; }
      record.el.classList.add('is-leaving');
      record.el.addEventListener('animationend', done, { once: true });
      window.setTimeout(done, 450);   // safety net if animationend never fires
    }

    function show(spec) {
      const o = spec || {};
      const kind = ICONS[o.kind] ? o.kind : 'info';
      const id = o.id || `toast-${++counter}`;
      const duration = o.duration !== undefined ? o.duration : DEFAULT_MS[kind];
      if (live.has(id)) remove(id, { immediate: true });   // same alert again: replace it, never stack duplicates

      const el = document.createElement('div');
      el.className = `toast toast--${kind}`;
      el.setAttribute('role', kind === 'error' || kind === 'warning' ? 'alert' : 'status');
      el.setAttribute('data-toast-id', id);

      const icon = document.createElement('span');
      icon.className = 'toast__icon';
      icon.innerHTML = ICONS[kind];
      el.appendChild(icon);

      const body = document.createElement('div');
      body.className = 'toast__body';
      if (o.titleKey || o.title) {
        const title = document.createElement('strong');
        title.className = 'toast__title';
        fillLine(title, o.titleKey, o.vars, o.title);
        body.appendChild(title);
      }
      if (o.messageKey || o.message) {
        const message = document.createElement('span');
        message.className = 'toast__msg';
        fillLine(message, o.messageKey, o.vars, o.message);
        body.appendChild(message);
      }
      el.appendChild(body);

      if (o.action && (o.action.labelKey || o.action.label)) {
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'toast__action';
        fillLine(action, o.action.labelKey, null, o.action.label);
        action.addEventListener('click', () => {
          remove(id);
          try { if (o.action.onClick) o.action.onClick(); } catch (err) { console.error('CourseTrack — toast action failed:', err); }
        });
        el.appendChild(action);
      }

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'toast__close';
      close.setAttribute('data-i18n-aria', 'toast.dismiss');
      close.innerHTML = CLOSE_ICON;
      close.addEventListener('click', () => remove(id));
      el.appendChild(close);

      el.addEventListener('keydown', (event) => { if (event.key === 'Escape') remove(id); });

      const record = { el, timer: null, remaining: duration, started: 0 };
      const start = () => {
        if (!(duration > 0) || live.get(id) !== record) return;
        record.started = Date.now();
        record.timer = window.setTimeout(() => remove(id), Math.max(record.remaining, 1500));
      };
      const pause = () => {
        if (!record.timer) return;
        window.clearTimeout(record.timer);
        record.timer = null;
        record.remaining -= Date.now() - record.started;
      };
      // reading time is never taken away from someone who is hovering or focused on the toast
      el.addEventListener('mouseenter', pause);
      el.addEventListener('mouseleave', start);
      el.addEventListener('focusin', pause);
      el.addEventListener('focusout', start);

      live.set(id, record);
      const host = getRegion();
      host.insertBefore(el, host.firstChild);      // newest first in the DOM (column-reverse puts it nearest the screen edge)
      I18N.apply(el);                              // resolves the aria-label keys
      while (host.children.length > MAX_VISIBLE) {
        const oldest = host.lastElementChild;
        remove(oldest.getAttribute('data-toast-id'), { immediate: true });
        if (oldest.parentNode) oldest.remove();
      }
      start();
      return { id, dismiss: () => remove(id) };
    }

    return {
      show,
      dismiss: (id) => remove(id),
      clear: () => Array.from(live.keys()).forEach((id) => remove(id, { immediate: true })),
      count: () => live.size,
    };
  })();

  /* =====================================================================
     FIREBASE REST CLIENT
     ---------------------------------------------------------------------
     request(url, options) resolves with the parsed JSON (or null) and
     otherwise throws a FirebaseError whose `kind` says what went wrong:

       timeout   no complete response in time (covers the body download too)
       offline   the request failed and the browser reports no connection
       network   the request failed (DNS, blocked, connection reset...)
       auth      HTTP 401 / 403, or a "Permission denied" answer
       notfound  HTTP 404 — almost always a wrong databaseURL
       ratelimit HTTP 429
       server    HTTP 5xx
       client    any other 4xx (e.g. 400 "Invalid data")
       parse     the answer was not valid JSON
       remote    HTTP 200 carrying { "error": "..." }

     options: method, body (object), timeoutMs, retries, silent,
              errorKeys ({ kind: 'dict.key' | (err) => ({ key, vars }) }).
     ===================================================================== */

  // A write must be allowed enough time to actually upload: the timeout is
  // the base plus one second for every 50 KB sent (i.e. at least 50 KB/s).
  const MIN_UPLOAD_BYTES_PER_SECOND = 50 * 1024;
  const timeoutFor = (baseMs, bodyBytes) => baseMs + Math.ceil((bodyBytes || 0) / MIN_UPLOAD_BYTES_PER_SECOND) * 1000;

  const RETRYABLE_KINDS = { network: true, server: true, ratelimit: true };   // never timeout (already long) or 4xx (retrying can't help)

  class FirebaseError extends Error {
    constructor(kind, message, extra) {
      super(message);
      this.name = 'FirebaseError';
      this.kind = kind;
      this.status = 0;            // HTTP status, when there was a response
      this.reason = '';           // Firebase's own message, when it sent one
      this.retryAfterMs = null;   // from a Retry-After header (capped), when present
      this.attempts = 1;          // how many tries were made before giving up
      this.i18nKey = null;        // set by applyErrorKeys: the dictionary key this error is shown with
      this.i18nVars = null;
      Object.assign(this, extra);
    }
  }

  function classifyStatus(status) {
    if (status === 401 || status === 403) return 'auth';
    if (status === 404) return 'notfound';
    if (status === 429) return 'ratelimit';
    if (status >= 500) return 'server';
    return 'client';
  }

  function describe(kind, status, reason, seconds) {
    switch (kind) {
      case 'timeout': return `Request timed out after ${seconds}s`;
      case 'offline': return 'The browser reports no network connection';
      case 'network': return 'The network request failed';
      case 'auth': return `Permission denied (HTTP ${status})${reason ? `: ${reason}` : ''}`;
      case 'notfound': return 'Database not found (HTTP 404)';
      case 'ratelimit': return 'Rate limited (HTTP 429)';
      case 'server': return `Server error (HTTP ${status})`;
      case 'parse': return 'The response was not valid JSON';
      default: return reason || `Request rejected (HTTP ${status})`;
    }
  }

  function withQuery(url, params) {
    const u = new URL(url);
    Object.keys(params).forEach((key) => u.searchParams.set(key, params[key]));
    return u.toString();
  }

  function backoffMs(attempt, retryAfterMs) {
    return retryAfterMs || Math.min(4000, 700 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 250);
  }

  /** One attempt. The abort timer stays armed through the body read, so a
   *  response that stalls mid-download settles too. */
  async function attemptOnce(url, method, bodyText, timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const seconds = Math.round(timeoutMs / 1000);
    try {
      let response;
      try {
        response = await window.fetch(url, {
          method,
          headers: bodyText !== undefined ? { 'Content-Type': 'application/json' } : undefined,
          body: bodyText,
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'omit',           // never send cookies to the database host
          referrerPolicy: 'no-referrer', // never tell it which page (or query string) the request came from
        });
      } catch (err) {
        if (timedOut || (err && err.name === 'AbortError')) throw new FirebaseError('timeout', describe('timeout', 0, '', seconds));
        const kind = window.navigator.onLine === false ? 'offline' : 'network';
        throw new FirebaseError(kind, describe(kind));
      }

      let text;
      try {
        text = await response.text();
      } catch (err) {
        if (timedOut || (err && err.name === 'AbortError')) throw new FirebaseError('timeout', describe('timeout', 0, '', seconds));
        throw new FirebaseError('network', describe('network'));
      }

      let data = null;
      let parseFailed = false;
      if (text) {
        try { data = JSON.parse(text); } catch (err) { parseFailed = true; }
      }

      if (!response.ok) {
        const reason = !parseFailed && data && typeof data.error === 'string' ? data.error : '';
        const retryAfter = Number(response.headers.get('Retry-After'));
        const kind = classifyStatus(response.status);
        throw new FirebaseError(kind, describe(kind, response.status, reason), {
          status: response.status,
          reason,
          retryAfterMs: retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : null,
        });
      }
      if (parseFailed) throw new FirebaseError('parse', describe('parse'), { status: response.status });

      // Firebase reports some failures as 200 + { "error": "<message>" } — a STRING.
      // (A record that merely has a key called "error" is data, not a failure.)
      if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.error === 'string') {
        const kind = /permission|unauthori[sz]ed/i.test(data.error) ? 'auth' : 'remote';
        throw new FirebaseError(kind, describe(kind, response.status, data.error), { status: response.status, reason: data.error });
      }
      return data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function applyErrorKeys(err, errorKeys) {
    const entry = errorKeys && errorKeys[err.kind];
    if (!entry) return err;
    const spec = typeof entry === 'function' ? entry(err) : { key: entry };
    if (spec && spec.key) {
      err.i18nKey = spec.key;                 // lets I18N.setErrorText() keep it translatable on screen
      err.i18nVars = spec.vars || null;
      err.message = I18N.t(spec.key, spec.vars);
    }
    return err;
  }

  async function request(url, options) {
    const o = Object.assign({ method: 'GET', body: undefined, timeoutMs: 15000, retries: 1, silent: false, errorKeys: null }, options);
    const method = String(o.method).toUpperCase();
    const bodyText = o.body === undefined ? undefined : JSON.stringify(o.body);
    const bytes = bodyText === undefined ? 0 : new TextEncoder().encode(bodyText).length;
    const timeoutMs = timeoutFor(o.timeoutMs, bytes);
    const target = o.silent ? withQuery(url, { print: 'silent' }) : url;   // a write's answer would just echo the whole dataset back

    // GET and PUT are idempotent, so repeating them after a transient failure is safe.
    const maxRetries = method === 'GET' || method === 'PUT' ? o.retries : 0;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await attemptOnce(target, method, bodyText, timeoutMs);
      } catch (err) {
        if (!(err instanceof FirebaseError)) throw err;   // a programming error must never be disguised as a network fault
        err.attempts = attempt;
        if (RETRYABLE_KINDS[err.kind] && attempt <= maxRetries) {
          await sleep(backoffMs(attempt, err.retryAfterMs));
          continue;
        }
        throw applyErrorKeys(err, o.errorKeys);
      }
    }
  }

  /** Alert kinds that deserve a toast (the rest are shown inline), and whether "Try again" can help. */
  const TOAST_BY_KIND = {
    timeout: { level: 'warning', retry: true },
    offline: { level: 'warning', retry: true },
    network: { level: 'error', retry: true },
    server: { level: 'error', retry: true },
    ratelimit: { level: 'warning', retry: true },
    auth: { level: 'error', retry: false, duration: 15000 },
    notfound: { level: 'error', retry: false, duration: 15000 },
  };

  /** The one place a failed Firebase call becomes a toast.
   *  scope 'student' or 'admin' picks the wording; onRetry adds a "Try again" button. */
  function reportError(err, options) {
    if (!(err instanceof FirebaseError)) return null;
    const spec = TOAST_BY_KIND[err.kind];
    if (!spec) return null;
    const scope = (options && options.scope) || 'student';
    const onRetry = options && options.onRetry;
    const base = `toast.msg.${err.kind}`;
    return toast.show({
      id: `firebase-${err.kind}`,
      kind: spec.level,
      titleKey: `toast.title.${err.kind}`,
      messageKey: I18N.has(`${base}.${scope}`) ? `${base}.${scope}` : base,
      action: spec.retry && onRetry ? { labelKey: 'toast.retry', onClick: onRetry } : null,
      duration: spec.duration,
    });
  }

  /** Opens the connection to the database host while the page is still loading. */
  function preconnect(databaseURL) {
    try {
      const origin = new URL(databaseURL).origin;
      if (document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = origin;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    } catch (err) { /* no/invalid URL: the page reports that itself */ }
  }

  /* =====================================================================
     SAFETY NET — nothing may fail silently
     ===================================================================== */
  function reportUnexpected(detail) {
    console.error('CourseTrack — unexpected error:', detail);
    toast.show({ id: 'unexpected', kind: 'error', titleKey: 'toast.title.unexpected', messageKey: 'toast.msg.unexpected', duration: 12000 });
  }

  function sameSource(filename) {
    try { return new URL(filename).origin === window.location.origin; } catch (err) { return false; }
  }

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason && reason.name === 'AbortError') return;   // an aborted request is expected, not a bug
    reportUnexpected(reason);
  });

  window.addEventListener('error', (event) => {
    // Cross-origin / extension noise ("Script error.") carries no detail and is not ours to report.
    if (!event.message || !event.filename || !sameSource(event.filename)) return;
    reportUnexpected(event.error || event.message);
  });

  /* ---------------------------------------------------------------------
     PUBLIC API — the only global this file adds
     --------------------------------------------------------------------- */
  window.CourseTrack = Object.freeze({
    keys: KEYS,
    ui: Object.freeze({ escapeHtml, escapeAttr, applyBrandColors, applyLogo, hideLoadingScreen, theme }),
    toast,
    firebase: Object.freeze({ request, FirebaseError, reportError, preconnect, withQuery, timeoutFor }),
  });

  const configured = window.APP_CONFIG && window.APP_CONFIG.firebase && window.APP_CONFIG.firebase.databaseURL;
  if (configured && !/PASTE_|YOUR_/i.test(configured)) preconnect(configured);
})();
