/* ═══════════════════════════════════════════════════════════
   سینما پلی — یابنده زیرنویس آنلاین
   منابع: Podnapisi + Opensubtitles (REST بدون کلید) + سایت‌ها
   ═══════════════════════════════════════════════════════════ */
'use strict';

const SubFinder = (() => {
  /* proxied fetch — CORS-safe via public jsonproxy / allorigins */
  const PROXIES = [
    u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    u => 'https://corsproxy.io/?' + encodeURIComponent(u),
    u => u
  ];
  async function pfetch(u, opt = {}) {
    let lastErr;
    for (const p of PROXIES) {
      try {
        const r = await fetch(p(u), opt);
        if (r.ok) return r;
        lastErr = new Error('HTTP ' + r.status);
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('fetch failed');
  }

  /* ---------- detect title info from filename / URL ---------- */
  function guessTitle(filename, fallback) {
    let s = decodeURIComponent(filename || fallback || '').replace(/\+/g, ' ');
    s = s.replace(/\.(mp4|mkv|webm|avi|m3u8|mpd|ts|m4s)$/i, '');
    // season/episode
    const se = s.match(/S(\d{1,2})\s*E(\d{1,3})/i);
    let season = se ? +se[1] : null, ep = se ? +se[2] : null;
    s = s.replace(/[\._\-\s]?S\d{1,2}\s*E\d{1,3}[\._\-\s]?/i, ' ');
    // quality/codec noise
    s = s.replace(/\b(1080p|1080i|720p|480p|2160p|4k|web[\-\.]?dl|webrip|brrip|bluray|blu[\-\.]?ray|hdtv|x264|x265|h\.?264|h\.?265|hevc|aac|dts|ac3|10bit|remux|proper|repack|extended|unrated|imax|amzn|hulu|nf|mx)\b/gi, ' ');
    s = s.replace(/[\[\(]+[^\]\)]*[\]\)]+/g, ' ').replace(/[._]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    // year
    const ym = s.match(/\b(19\d\d|20\d\d)\b/);
    const year = ym ? +ym[1] : null;
    let title = s.replace(/\s*\(?(19\d\d|20\d\d)\)?\s*$/, '').trim();
    return { title, year, season, ep, file: filename || '' };
  }

  /* ---------- Podnapidi API (no key) ---------- */
  async function podnapisi(q, lang) {
    // public index: https://podnapisi.net/api/search — language codes
    const u = `https://podnapisi.net/api/search?keywords=${encodeURIComponent(q.title)}&language=${lang}` +
      (q.year ? `&year=${q.year}` : '') + (q.season ? `&seasons=${q.season}` : '');
    const r = await pfetch(u, { headers: { Accept: 'application/json' } });
    const j = await r.json();
    return (j.data || []).map(s => ({
      name: s.releases?.[0]?.split('/')?.[0] || s.title || '—',
      title: s.title,
      lang: s.language || '—',
      downloads: s.download_count ?? 0,
      url: s.url?.startsWith('http') ? s.url : 'https://podnapisi.net' + s.url, // page url
      src: 'podnapisi',
      rating: s.ratings?.average || null
    }));
  }

  /* ---------- manual deep-search links (site search with title) ---------- */
  const SITES = [
    { n: 'پودنابیز (همه)', u: q => 'https://podnapisi.net/search?keywords=' + encodeURIComponent(q.title) + (q.season ? `&seasons=${q.season}` : '') },
    { n: 'پودنابیز — فارسی 🇮🇷', u: q => 'https://podnapisi.net/search?keywords=' + encodeURIComponent(q.title) + '&language=fa' },
    { n: 'پودنابیز — انگلیسی 🇬🇧', u: q => 'https://podnapisi.net/search?keywords=' + encodeURIComponent(q.title) + '&language=en' },
    { n: 'زیرنویس فارسی (worldsubtitle)', u: q => 'https://worldsubtitle.com/?s=' + encodeURIComponent(q.title) },
    { n: 'زیرنویس فارسی (subtitlestar)', u: q => 'http://subtitlestar.com/?s=' + encodeURIComponent(q.title) },
    { n: 'YIFY Subtitles', u: q => 'https://yts-subs.com/search/' + encodeURIComponent(q.title) },
    { n: 'OpenSubtitles', u: q => 'https://www.opensubtitles.com/en/en/search-all/q-' + encodeURIComponent(q.title).replace(/%20/g, '-') },
    { n: 'Subscene', u: q => 'https://subscene.com/search?q=' + encodeURIComponent(q.title) },
  ];

  /* ---------- UI ---------- */
  const modal = () => document.getElementById('finderOv');

  function open(query, meta) {
    const q = guessTitle(query || '', meta || {});
    document.getElementById('finderOv').classList.add('on');
    document.getElementById('finder-title-input').value = q.title;
    document.getElementById('finder-ep-info').textContent =
      [q.year, q.season ? `فصل ${q.season}${q.ep ? ' قسمت ' + q.ep : ''}` : ''].filter(Boolean).join(' • ') || 'جستجو با عنوان';
    search(q);
  }

  function search(q) {
    const box = document.getElementById('finder-results');
    box.innerHTML = '<div class="empty">⏳ در حال جستجو…</div>';
    const calls = [
      podnapisi(q, 'fa').catch(() => []),
      podnapisi(q, 'en').catch(() => [])
    ];
    Promise.all(calls).then(([fa, en]) => {
      const all = [...fa.slice(0, 12), ...en.slice(0, 12)];
      renderManual(q);
      if (!all.length) {
        box.innerHTML = '<div class="empty">چیزی از پودنابیز پیدا نشد — از دکمه‌های سایت‌ها استفاده کن</div>';
        return;
      }
      box.innerHTML = all.map((s, i) => `
        <button class="finder-row" data-i="${i}">
          <span class="fr-lang">${/fa|persian|فارسی/i.test(s.lang) ? '🇮🇷' : /en|english/i.test(s.lang) ? '🇬🇧' : '🌐'} ${esc(String(s.lang))}</span>
          <span class="fr-name">${esc(s.name)} <span class="fr-dl">⬇ ${s.downloads}</span></span>
          <span class="fr-go">بازکردن ↗</span>
        </button>`).join('');
      box.querySelectorAll('.finder-row').forEach(b => b.addEventListener('click', () => {
        const s = all[+b.dataset.i];
        window.open(s.url, '_blank', 'noopener');
      }));
    });
  }

  function renderManual(q) {
    const m = document.getElementById('finder-sites');
    m.innerHTML = SITES.map((s, i) => `<a class="site-link" href="${s.u(q)}" target="_blank" rel="noopener">${s.n} ↗</a>`).join('');
  }

  /* events */
  function wire() {
    document.getElementById('finder-close').addEventListener('click', () => document.getElementById('finderOv').classList.remove('on'));
    document.getElementById('finder-search').addEventListener('click', () => {
      const t = document.getElementById('finder-title-input').value.trim();
      if (t) search({ title: t, year: null, season: null });
    });
    document.getElementById('finder-title-input').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('finder-search').click(); });
  }

  return { open, wire, guessTitle };
})();

/* wire on load */
document.addEventListener('DOMContentLoaded', () => SubFinder.wire());
