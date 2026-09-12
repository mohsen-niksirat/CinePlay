/* ═══════════════════════════════════════════════════════════
   سینما پلی — یابنده زیرنویس آنلاین
   منابع: Podnapisi (REST بدون کلید) + سایت‌ها + تاریخچه جستجو
   از Net.cpFetch استفاده می‌کند (پروکسی خودکار CORS)
   ═══════════════════════════════════════════════════════════ */
'use strict';

const SubFinder = (() => {
  /* ---------- detect title info from filename / URL ---------- */
  function guessTitle(filename, fallback) {
    let s = decodeURIComponent(String(filename || fallback || '')).replace(/\+/g, ' ');
    s = s.replace(/\.(mp4|mkv|webm|avi|m3u8|mpd|ts|m4s)$/i, '');
    const se = s.match(/S(\d{1,2})\s*E(\d{1,3})/i);
    let season = se ? +se[1] : null, ep = se ? +se[2] : null;
    s = s.replace(/[\._\-\s]?S\d{1,2}\s*E\d{1,3}[\._\-\s]?/i, ' ');
    s = s.replace(/\b(1080p|1080i|720p|480p|2160p|4k|web[\-\.]?dl|webrip|brrip|bluray|blu[\-\.]?ray|hdtv|x264|x265|h\.?264|h\.?265|hevc|aac|dts|ac3|10bit|remux|proper|repack|extended|unrated|imax|amzn|hulu|nf|mx)\b/gi, ' ');
    s = s.replace(/[\[\(]+[^\]\)]*[\]\)]+/g, ' ').replace(/[._]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    const ym = s.match(/\b(19\d\d|20\d\d)\b/);
    const year = ym ? +ym[1] : null;
    let title = s.replace(/\s*\(?(19\d\d|20\d\d)\)?\s*$/, '').trim();
    return { title, year, season, ep, file: filename || '' };
  }

  /* ---------- Podnapisi REST (بدون کلید) — با cpFetch ---------- */
  async function podnapisi(q, lang) {
    const u = `https://podnapisi.net/api/search?keywords=${encodeURIComponent(q.title)}&language=${lang}` +
      (q.year ? `&year=${q.year}` : '') + (q.season ? `&seasons=${q.season}` : '');
    const r = await Net.cpFetch(u, { headers: { Accept: 'application/json' } });
    const j = await r.json();
    return (j.data || []).map(s => ({
      name: s.releases?.[0]?.split('/')?.[0] || s.title || '—',
      title: s.title,
      lang: s.language || '—',
      downloads: s.download_count ?? 0,
      url: s.url?.startsWith('http') ? s.url : 'https://podnapisi.net' + s.url,
      src: 'podnapisi',
      rating: s.ratings?.average || null
    }));
  }

  /* ---------- manual deep-search links ---------- */
  const SITES = [
    { n: 'پودنابیز (همه)', u: q => 'https://podnapisi.net/search?keywords=' + encodeURIComponent(q.title) + (q.season ? `&seasons=${q.season}` : '') },
    { n: 'پودنابیز — فارسی 🇮🇷', u: q => 'https://podnapisi.net/search?keywords=' + encodeURIComponent(q.title) + '&language=fa' },
    { n: 'پودنابیز — انگلیسی 🇬🇧', u: q => 'https://podnapisi.net/search?keywords=' + encodeURIComponent(q.title) + '&language=en' },
    { n: 'زیرنویس فارسی (worldsubtitle)', u: q => 'https://worldsubtitle.com/?s=' + encodeURIComponent(q.title) },
    { n: 'زیرنویس فارسی (subtitlestar)', u: q => 'http://subtitlestar.com/?s=' + encodeURIComponent(q.title) },
    { n: 'YIFY Subtitles', u: q => 'https://yts-subs.com/search/' + encodeURIComponent(q.title) },
    { n: 'OpenSubtitles', u: q => 'https://www.opensubtitles.com/en/en/search-all/q-' + encodeURIComponent(q.title).replace(/%20/g, '-') },
    { n: 'Subscene', u: q => 'https://subscene.com/search?q=' + encodeURIComponent(q.title) }
  ];

  /* ---------- search history (localStorage) ---------- */
  const HKEY = 'cp-subsearch-history';
  const getHistory = () => { try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch (e) { return []; } };
  function pushHistory(t) {
    const h = getHistory().filter(x => x !== t);
    h.unshift(t);
    localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 10)));
  }
  function renderHistory() {
    const box = document.getElementById('finder-history');
    const h = getHistory();
    if (!h.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
    box.style.display = '';
    box.innerHTML = '<h4>جستجوهای اخیر</h4>' + h.map(t =>
      `<button class="site-link" data-h="${esc(t)}">🕘 ${esc(t)}</button>`).join('');
    box.querySelectorAll('[data-h]').forEach(b => b.onclick = () => {
      document.getElementById('finder-title-input').value = b.dataset.h;
      search({ title: b.dataset.h, year: null, season: null });
    });
  }

  /* ---------- UI ---------- */
  function open(query, meta) {
    const q = guessTitle(query || '', meta || {});
    document.getElementById('finderOv').classList.add('on');
    document.getElementById('finder-title-input').value = q.title;
    document.getElementById('finder-ep-info').textContent =
      [q.year, q.season ? `فصل ${q.season}${q.ep ? ' قسمت ' + q.ep : ''}` : ''].filter(Boolean).join(' • ') || 'جستجو با عنوان';
    renderHistory();
    search(q);
  }

  function search(q) {
    if (!q.title || q.title.length < 2) { document.getElementById('finder-results').innerHTML = '<div class="empty">عنوانی برای جستجو نیست</div>'; return; }
    pushHistory(q.title);
    renderHistory();
    const box = document.getElementById('finder-results');
    box.innerHTML = '<div class="empty">⏳ در حال جستجو…</div>';
    Promise.all([
      podnapisi(q, 'fa').catch(() => []),
      podnapisi(q, 'en').catch(() => [])
    ]).then(([faList, enList]) => {
      const all = [...faList.slice(0, 12), ...enList.slice(0, 12)];
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
    }).catch(() => {
      box.innerHTML = '<div class="empty">جستجو ناموفق بود — اتصال یا فیلترشکن را چک کن</div>';
    });
  }

  function renderManual(q) {
    document.getElementById('finder-sites').innerHTML = SITES.map(s => `<a class="site-link" href="${s.u(q)}" target="_blank" rel="noopener">${s.n} ↗</a>`).join('');
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

document.addEventListener('DOMContentLoaded', () => SubFinder.wire());
