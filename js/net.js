/* ═══════════════════════════════════════════════════════════
   سینما پلی — لایه شبکه: پروکسی خودکار CORS
   - cpFetch: fetch مستقیم → fallback به زنجیره پروکسی‌های عمومی
   - CPHlsLoader: لودر سفارشی hls.js که URL ها را پروکسی می‌کند
   ═══════════════════════════════════════════════════════════ */
'use strict';

const Net = (() => {
  /* پروکسی‌های عمومی CORS — به‌ترتیب اولویت */
  const PROXIES = [
    // u → پروکسی‌شده؛ بازگرداندن Response با same-origin
    u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    u => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
    u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
    u => 'https://thingproxy.freeboard.io/fetch/' + u
  ];

  /* کدام دامنه‌ها نیازی به پروکسی ندارند (خودمون / گیت‌هاب) */
  const DIRECT_OK = origin => {
    try { const h = new URL(origin, location.href).hostname; return h === location.hostname || /github\.io|githubusercontent\.com|localhost|127\.0\.0\.1/.test(h); } catch (e) { return false; }
  };

  const state = { enabled: true, activeProxy: -1, proxyTested: false };

  /* ---------- cpFetch: مستقیم، بعد پروکسی‌ها ---------- */
  async function cpFetch(url, opt = {}) {
    // تلاش مستقیم
    try {
      const r = await fetch(url, opt);
      if (r.ok) return r;
      if (r.status === 404) return r; // 404 واقعی را پاس بده — پروکسی هم نمی‌تواند
    } catch (e) { /* CORS/شبکه → پروکسی */ }

    if (!state.enabled) throw new Error('proxy disabled');
    if (DIRECT_OK(url)) throw new Error('direct failed on own origin');

    // از پروکسی فعال شروع کن (اگر قبلاً پیدا شده)، وگرنه همه را امتحان کن
    const order = state.activeProxy >= 0
      ? [state.activeProxy, ...PROXIES.map((_, i) => i).filter(i => i !== state.activeProxy)]
      : PROXIES.map((_, i) => i);

    let lastErr;
    for (const i of order) {
      try {
        const r = await fetch(PROXIES[i](url), opt);
        if (r.ok) { state.activeProxy = i; return r; }
        lastErr = new Error('HTTP ' + r.status);
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('all proxies failed');
  }

  /* ---------- HLS: manifest بازنویسی‌شده (نسبی → مطلق) ---------- */
  function absolutize(manifestText, baseUrl) {
    // خطوطی که URL هستند (نه #tag) → absolute
    return manifestText.split('\n').map(line => {
      const t = line.trim();
      if (!t || t.startsWith('#')) {
        // URI="..." داخل تگ‌ها (KEY / MEDIA / MAP)
        return line.replace(/URI="([^"]+)"/g, (m, u) =>
          'URI="' + (isAbsolute(u) ? u : new URL(u, baseUrl).href) + '"');
      }
      return isAbsolute(t) ? t : new URL(t, baseUrl).href;
    }).join('\n');
  }
  const isAbsolute = u => /^https?:\/\//i.test(u);

  /* ---------- لودر سفارشی hls.js — همه fragment ها از پروکسی ---------- */
  function makeProxyLoader(BaseLoaderClass) {
    class ProxyLoader extends BaseLoaderClass {
      load(context, config, callbacks) {
        // direct first — if it fails, hls.js retries; we flip to proxy after 2 network errors
        if (Net.forceProxy && !DIRECT_OK(context.url)) {
          context.url = PROXIES[state.activeProxy >= 0 ? state.activeProxy : 0](context.url);
        }
        return super.load(context, config, callbacks);
      }
    }
    return ProxyLoader;
  }

  /* ---------- تست پروکسی‌ها (پس از اولین خطای شبکه) ---------- */
  async function testProxies() {
    for (let i = 0; i < PROXIES.length; i++) {
      try {
        const r = await fetch(PROXIES[i]('https://example.com'), { method: 'GET' });
        if (r.ok || r.status === 403) { state.activeProxy = i; return i; }
      } catch (e) { }
    }
    return -1;
  }

  return {
    cpFetch, absolutize, makeProxyLoader, testProxies,
    get activeProxy() { return state.activeProxy; },
    get forceProxy() { return state._force; },
    set forceProxy(v) { state._force = v; },
    get enabled() { return state.enabled; },
    set enabled(v) { state.enabled = v; },
    PROXIES
  };
})();
