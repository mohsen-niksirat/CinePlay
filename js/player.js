/* ═══════════════════════════════════════════════════════════
   سینما پلی — هسته پلیر
   ═══════════════════════════════════════════════════════════ */
'use strict';

const $ = id => document.getElementById(id);
const video = $('video');
const stage = $('stage');

/* ---------- helpers ---------- */
const fa = n => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
const fmt = s => {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(sec).padStart(2, '0');
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastT;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 2200);
}

/* ---------- state ---------- */
const S = {
  src: '', title: '', poster: '', imdb: '',
  versions: [],        // [{name, src, badge}]
  episodes: [],        // [{season, ep, name, src, poster}]
  curEp: -1,
  curVer: 0,
  hls: null,
  duration: 0,
  savedPos: 0,
  resumeOffered: false,
  autoNext: localStorage.getItem('cp-autonext') !== '0',
  uiTimer: null,
  sleepAt: 0, sleepEnd: false,
  abA: -1, abB: -1,
  skipIntroSec: parseInt(localStorage.getItem('cp-skipintro') || '0'),
  retryCount: 0
};

/* storage keys — per video identity */
function posKey() { return 'cp-pos:' + (S.imdb || S.src); }
function watchedKey() { return 'cp-watched:' + (S.imdb || S.src); }

/* ---------- URL params ---------- */
function parseParams() {
  const p = new URLSearchParams(location.search);
  if (p.get('src')) return {
    src: p.get('src'), title: p.get('title') || '', poster: p.get('poster') || '',
    imdb: p.get('imdb') || '', sub: p.get('sub') || '', next: p.get('next') || ''
  };
  if (location.hash.startsWith('#j=')) {
    try {
      const j = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(3)))));
      return { src: j.src || '', title: j.title || '', poster: j.poster || '', imdb: j.imdb || '', sub: (j.subs && j.subs[0]) || '', next: (j.episodes && j.episodes[1] && j.episodes[1].src) || '', raw: j };
    } catch (e) { }
  }
  return null;
}

/* ---------- recents ---------- */
function getRecents() { try { return JSON.parse(localStorage.getItem('cp-recents') || '[]'); } catch (e) { return []; } }
function pushRecent() {
  if (!S.src) return;
  const list = getRecents().filter(r => r.src !== S.src);
  list.unshift({
    src: S.src, title: S.title || 'بدون عنوان', poster: S.poster || '', imdb: S.imdb,
    ep: S.episodes.length && S.curEp >= 0 ? S.episodes[S.curEp].name : '',
    pos: video.currentTime, dur: S.duration, at: Date.now(), versions: S.versions.slice(0, 8), episodes: S.episodes.slice(0, 200)
  });
  localStorage.setItem('cp-recents', JSON.stringify(list.slice(0, 20)));
}

function renderRecents() {
  const box = $('recents');
  const list = getRecents().filter(r => r.src);
  if (!list.length) { box.innerHTML = '<div class="empty">هنوز چیزی تماشا نکرده‌اید — لینک ویدیو را بچسبانید و پخش کنید 🎬</div>'; return; }
  box.innerHTML = '<div class="recent-grid">' + list.map((r, i) => `
    <div class="recent-card" data-i="${i}">
      ${r.poster ? `<img src="${esc(r.poster)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'">` : ''}
      <div class="rc-badge">${r.ep ? esc(r.ep) : '🎬'}</div>
      <button class="rc-del" data-del="${i}">✕</button>
      <div class="rc-info">
        <div class="rc-title">${esc(r.title)}</div>
        <div class="rc-sub">${r.pos && r.dur ? fmt(r.pos) + ' / ' + fmt(r.dur) : 'آنلاین'}</div>
      </div>
      ${r.pos && r.dur ? `<div class="rc-progress"><i style="width:${clamp(r.pos / r.dur * 100, 0, 100)}%"></i></div>` : ''}
    </div>`).join('') + '</div>';

  box.querySelectorAll('.recent-card').forEach(c => {
    c.addEventListener('click', e => {
      if (e.target.closest('.rc-del')) {
        const l = getRecents(); l.splice(+e.target.closest('.rc-del').dataset.del, 1);
        localStorage.setItem('cp-recents', JSON.stringify(l)); renderRecents(); return;
      }
      const r = getRecents()[+c.dataset.i];
      if (!r) return;
      S.versions = r.versions || []; S.episodes = r.episodes || [];
      openPlayer(r.src, r.title, r.poster, r.imdb);
    });
  });
}

/* ---------- home form ---------- */
function parseLines(v, n = 3) {
  return v.split('\n').map(l => l.trim()).filter(Boolean).map(l => l.split('|').map(x => x.trim()));
}
$('btn-play').addEventListener('click', () => {
  const src = $('inp-src').value.trim();
  if (!src) { toast('لینک ویدیو را وارد کنید'); $('inp-src').focus(); return; }
  S.versions = parseLines($('inp-vers').value).filter(p => p.length >= 2).map(p => ({ name: p[0], src: p[1], badge: /دوبله|dub/i.test(p[0]) ? '🗣' : '🎬' }));
  S.episodes = parseLines($('inp-eps').value).filter(p => p.length >= 4).map(p => ({ season: +p[0] || 1, ep: +p[1] || 1, name: p[2], src: p[3] }));
  const subLinks = $('inp-subs').value.split('\n').map(x => x.trim()).filter(Boolean);
  openPlayer(src, $('inp-title').value.trim(), $('inp-poster').value.trim(), $('inp-imdb').value.trim(), subLinks);
});

$('btn-paste').addEventListener('click', async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (t) { $('inp-src').value = t.trim(); toast('چسبانده شد ✓'); }
  } catch (e) { toast('اجازه دسترسی به کلیپ‌بورد داده نشد'); }
});

/* ---------- open / close player ---------- */
function openPlayer(src, title, poster, imdb, subLinks) {
  S.src = src; S.title = title || ''; S.poster = poster || ''; S.imdb = imdb || '';
  S.curEp = -1; S.curVer = 0; S.resumeOffered = false; S.retryCount = 0;
  S.savedPos = 0; S.isLocalFile = src.startsWith('blob:');
  $('player').classList.add('on');
  document.body.style.overflow = 'hidden';
  if (S.isLocalFile) { /* skip fullscreen request for local files (keeps things simple) */ }
  renderTitle();
  renderEpsBtn(); renderVersBtn();
  pushBackState();
  if (subLinks && subLinks.length) Subs.addRemote(subLinks);
  loadSource(src);
  const saved = parseFloat(localStorage.getItem(posKey()) || '0');
  if (saved > 20) S.savedPos = saved;
}

function closePlayer() {
  savePos(); pushRecent();
  if (S.hls) { S.hls.destroy(); S.hls = null; }
  video.removeAttribute('src'); video.load();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
  $('player').classList.remove('on');
  document.body.style.overflow = '';
  renderRecents();
}

$('btn-close').addEventListener('click', closePlayer);
$('err-back').addEventListener('click', closePlayer);
$('btn-quality').addEventListener('click', e => { wireQuality(); togglePop('pop-quality', e.currentTarget); });

function renderTitle() {
  $('v-title').textContent = S.title || 'پخش آنلاین';
  $('v-sub').textContent = S.episodes.length && S.curEp >= 0
    ? `فصل ${fa(S.episodes[S.curEp].season)} • قسمت ${fa(S.episodes[S.curEp].ep)}` : '';
}
function renderEpsBtn() { $('btn-eps').style.display = S.episodes.length ? '' : 'none'; $('btn-prev-ep').style.display = S.episodes.length ? '' : 'none'; }
function renderVersBtn() { $('btn-vers').style.display = S.versions.length ? '' : 'none'; }

/* ---------- source loading ---------- */
function isHls(u) { return /\.m3u8($|\?)/i.test(u) || /\.m3u($|\?)/i.test(u); }

function loadSource(src, keepPos) {
  hideErr(); showSpinner(true);
  Subs.reset();
  const pos = keepPos ? video.currentTime : 0;
  if (S.hls) { S.hls.destroy(); S.hls = null; }

  if (isHls(src) && window.Hls && Hls.isSupported()) {
    const hls = new Hls({ maxBufferLength: 30, manifestLoadingMaxRetry: 3, fragLoadingMaxRetry: 4 });
    S.hls = hls;
    hls.on(Hls.Events.ERROR, (e, d) => {
      if (d.fatal) showError('خطا در استریم HLS', 'اتصال قطع شد یا لینک معتبر نیست.');
    });
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => { showSpinner(false); tryPlay(); updQualityBtn(); });
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => updQualityBtn());
  } else {
    video.src = src;
    video.load();
  }
  if (keepPos) video.currentTime = pos;
}

video.addEventListener('loadedmetadata', () => { S.duration = video.duration || 0; $('t-dur').textContent = fmt(S.duration); showSpinner(false); maybeOfferResume(); });
video.addEventListener('error', () => {
  if (!video.src && !S.hls) return;
  if (S.retryCount < 2) { S.retryCount++; toast('تلاش مجدد (' + fa(S.retryCount) + ')…'); setTimeout(() => loadSource(S.src, S.retryCount > 1), 1500); }
  else showError('ویدیو پخش نشد', 'لینک مستقیم نیست، سرور پاسخ نمی‌دهد یا اجازه CORS داده نشده. لینک را در مرورگر باز کنید تا مشکل مشخص شود.');
});
video.addEventListener('waiting', () => showSpinner(true));
video.addEventListener('playing', () => { showSpinner(false); hideUISoon(); });
video.addEventListener('canplay', () => showSpinner(false));

function showSpinner(on) { $('spinner').classList.toggle('on', on); }
function showError(t, m) { $('err-title').textContent = t; $('err-msg').textContent = m; $('errOv').classList.add('on'); showSpinner(false); }
function hideErr() { $('errOv').classList.remove('on'); }
$('err-retry').addEventListener('click', () => { S.retryCount = 0; loadSource(video.currentSrc || S.src); });

/* resume */
function maybeOfferResume() {
  if (S.resumeOffered || !S.savedPos || S.savedPos < 20 || S.savedPos >= (S.duration - 30)) return;
  S.resumeOffered = true;
  $('resume-time').textContent = fmt(S.savedPos);
  $('resumeOv').classList.add('on');
}
$('resume-yes').addEventListener('click', () => { video.currentTime = S.savedPos; $('resumeOv').classList.remove('on'); tryPlay(); });
$('resume-no').addEventListener('click', () => { $('resumeOv').classList.remove('on'); tryPlay(); });

function tryPlay() {
  video.play().catch(() => { /* user gesture needed */ });
}

/* ---------- play/pause ---------- */
function togglePlay() {
  if (video.paused) { video.play().catch(() => { }); }
  else { video.pause(); showUI(999999); }
}
video.addEventListener('play', () => { $('ic-play').style.display = 'none'; $('ic-pause').style.display = ''; $('bigPlay').classList.add('hide'); });
video.addEventListener('pause', () => { $('ic-play').style.display = ''; $('ic-pause').style.display = 'none'; if (!video.ended) { $('bigPlay').classList.remove('hide'); showUI(999999); } });
video.addEventListener('click', togglePlay);
$('bigPlay').addEventListener('click', togglePlay);
$('btn-play-pause').addEventListener('click', togglePlay);

/* ---------- seek UI ---------- */
const seek = $('seek');
let seeking = false;

function seekPct(e) {
  const r = seek.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
  return clamp(1 - x / r.width, 0, 1); // RTL: right = 0
}
seek.addEventListener('pointerdown', e => {
  seeking = true; seek.setPointerCapture(e.pointerId); video.pause();
  updateSeekUI(seekPct(e)); showUI(999999);
});
seek.addEventListener('pointermove', e => {
  if (!seeking) { showTip(e); return; }
  updateSeekUI(seekPct(e));
});
seek.addEventListener('pointerup', e => {
  if (!seeking) return; seeking = false;
  video.currentTime = seekPct(e) * S.duration;
  if (!$('resumeOv').classList.contains('on')) video.play().catch(() => { });
});
seek.addEventListener('pointerleave', () => { $('seekTip').classList.remove('on'); });

function updateSeekUI(p) {
  const pct = (p * 100).toFixed(3) + '%';
  $('playedBar').style.width = pct; $('knob').style.right = pct;
  $('t-cur').textContent = fmt(p * S.duration);
}
function showTip(e) {
  const tip = $('seekTip');
  const p = seekPct(e);
  tip.textContent = fmt(p * S.duration);
  const r = seek.getBoundingClientRect();
  tip.style.right = ((1 - p) * r.width) + 'px';
  tip.classList.add('on');
}

/* time update */
video.addEventListener('timeupdate', () => {
  if (!seeking) {
    const p = S.duration ? video.currentTime / S.duration : 0;
    $('playedBar').style.width = (p * 100) + '%'; $('knob').style.right = (p * 100) + '%';
    $('t-cur').textContent = fmt(video.currentTime);
  }
  // buffer
  try {
    const b = video.buffered;
    if (b.length) {
      const end = b.end(b.length - 1);
      $('bufferBar').style.width = (S.duration ? end / S.duration * 100 : 0) + '%';
    }
  } catch (e) { }
  // save pos every ~5s
  if (Math.floor(video.currentTime) % 5 === 0) savePos();
  // AB repeat
  if (S.abA >= 0 && S.abB > S.abA && video.currentTime >= S.abB) video.currentTime = S.abA;
  // skip intro button
  const show = S.skipIntroSec > 0 && video.currentTime < S.skipIntroSec && video.currentTime > 2;
  $('skipIntro').classList.toggle('on', show);
});
video.addEventListener('ended', () => {
  savePos(0); pushRecent();
  if (S.sleepEnd) { closePlayer(); return; }
  playNextEp(true);
});

function savePos(v) {
  if (!S.src) return;
  const t = v !== undefined ? v : video.currentTime;
  if (t > 0) localStorage.setItem(posKey(), String(t));
  else localStorage.removeItem(posKey());
}

/* ---------- 10s skip buttons ---------- */
$('btn-next').addEventListener('click', () => { video.currentTime = clamp(video.currentTime + 10, 0, S.duration); toast('⏩ ۱۰ ثانیه'); });
$('btn-back').addEventListener('click', () => { video.currentTime = clamp(video.currentTime - 10, 0, S.duration); toast('⏪ ۱۰ ثانیه'); });

/* double-tap gesture (mobile) */
let lastTap = 0, lastTapX = 0;
stage.addEventListener('touchend', e => {
  if (e.target.closest('.controls, .topbar, .panel, .pop, .skip-btn, .next-card, .big-center')) return;
  const now = Date.now(), x = e.changedTouches[0].clientX;
  if (now - lastTap < 300 && Math.abs(x - lastTapX) < 60) {
    const w = stage.clientWidth, rel = x / w;
    if (rel < 0.35) doSeekRel(-10, 'l');
    else if (rel > 0.65) doSeekRel(10, 'r');
    else togglePlay();
    lastTap = 0;
  } else { lastTap = now; lastTapX = x; }
});
function doSeekRel(d, side) {
  video.currentTime = clamp(video.currentTime + d, 0, S.duration);
  const r = document.createElement('div');
  r.className = 'ripple ' + side;
  r.innerHTML = (d > 0 ? '⏩' : '⏪') + '<span>' + fa(Math.abs(d)) + ' ثانیه</span>';
  stage.appendChild(r); setTimeout(() => r.remove(), 500);
}

/* ---------- volume ---------- */
$('vol').addEventListener('input', e => { video.volume = +e.target.value; video.muted = false; updVolIc(); });
$('btn-mute').addEventListener('click', () => { video.muted = !video.muted; updVolIc(); });
function updVolIc() {
  $('ic-vol').style.display = video.muted || video.volume === 0 ? 'none' : '';
  $('ic-mute').style.display = video.muted || video.volume === 0 ? '' : 'none';
}

/* ---------- fullscreen / PiP ---------- */
$('btn-full').addEventListener('click', toggleFull);
function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
  else ($('player').requestFullscreen?.() || stage.requestFullscreen?.()).catch?.(() => { });
}
document.addEventListener('fullscreenchange', () => { });

$('btn-pip').addEventListener('click', async () => {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  } catch (e) { toast('PiP در این مرورگر پشتیبانی نمی‌شود'); }
});

/* ---------- speed ---------- */
$('btn-speed').addEventListener('click', e => { togglePop('pop-speed', e.currentTarget); });
document.querySelectorAll('#pop-speed .opt').forEach(b => b.addEventListener('click', () => {
  video.playbackRate = +b.dataset.spd;
  document.querySelectorAll('#pop-speed .opt').forEach(x => x.classList.toggle('active', x === b));
  $('btn-speed').textContent = b.textContent.replace('× (عادی)', '×');
  togglePop('pop-speed');
}));

/* ---------- popovers ---------- */
function togglePop(id, anchor) {
  const p = $(id);
  document.querySelectorAll('.pop').forEach(x => { if (x !== p) x.classList.remove('on'); });
  if (!p.classList.contains('on') && anchor) {
    const r = anchor.getBoundingClientRect();
    const pw = p.offsetWidth || 180;
    p.style.left = clamp(r.left + r.width / 2 - pw / 2, 8, innerWidth - pw - 8) + 'px';
    if (p.classList.contains('on')) p.classList.remove('on');
  }
  p.classList.toggle('on');
}
document.addEventListener('click', e => {
  if (!e.target.closest('.pop') && !e.target.closest('#btn-speed, #btn-subs, #btn-menu, #btn-full')) {
    document.querySelectorAll('.pop').forEach(x => x.classList.remove('on'));
  }
});

/* ---------- panels ---------- */
function togglePanel(id) {
  const p = $(id);
  const wasOn = p.classList.contains('on');
  document.querySelectorAll('.panel').forEach(x => x.classList.remove('on'));
  if (!wasOn) p.classList.add('on');
}
document.querySelectorAll('[data-close-panel]').forEach(b => b.addEventListener('click', () => $(b.dataset.closePanel).classList.remove('on')));
$('btn-eps').addEventListener('click', () => { renderEpsPanel(); togglePanel('panel-eps'); });
$('btn-vers').addEventListener('click', () => { renderVersPanel(); togglePanel('panel-vers'); });

/* ---------- episodes ---------- */
function currentEpIndex() { return S.episodes.findIndex(x => x.src === S.src); }

function renderEpsPanel() {
  const box = $('epsList');
  if (!S.episodes.length) { box.innerHTML = '<div class="empty">اپیزودی اضافه نشده</div>'; return; }
  const cur = currentEpIndex();
  const bySeason = {};
  S.episodes.forEach((e, i) => { (bySeason[e.season] = bySeason[e.season] || []).push([e, i]); });
  box.innerHTML = Object.keys(bySeason).map(season => `
    <div class="ep-season">فصل ${fa(season)}</div>
    ${bySeason[season].map(([e, i]) => {
    const watched = parseFloat(localStorage.getItem('cp-wpos:' + (S.imdb || S.src) + ':' + i) || '0');
    const done = watched > 90 ? '✓' : '';
    return `<button class="ep-item ${i === cur ? 'current' : ''}" data-i="${i}">
        <span class="ep-num">${fa(e.ep)}</span>
        <span class="ep-name">${esc(e.name || 'قسمت ' + fa(e.ep))}</span>
        ${done ? '<span class="ep-check">✓</span>' : ''}
        ${watched && !done ? `<span class="ep-watched-bar" style="width:${clamp(watched, 0, 100)}%"></span>` : ''}
      </button>`;
  }).join('')}`).join('');

  box.querySelectorAll('.ep-item').forEach(b => b.addEventListener('click', () => playEp(+b.dataset.i)));
}

function playEp(i) {
  const e = S.episodes[i];
  if (!e) return;
  S.curEp = i;
  localStorage.setItem('cp-wpos:' + (S.imdb || S.src) + ':' + i, '100');
  renderTitle();
  $('panel-eps').classList.remove('on');
  playSrc(e.src, e.name);
}
function playSrc(src, label) {
  S.savedPos = 0; S.resumeOffered = false;
  loadSource(src);
  if (label) toast(label);
}
$('btn-prev-ep').addEventListener('click', () => {
  const cur = currentEpIndex();
  if (cur > 0) playEp(cur - 1); else toast('اپیزود قبلی وجود ندارد');
});

function nextEp() {
  const cur = currentEpIndex();
  if (cur >= 0 && cur < S.episodes.length - 1) return S.episodes[cur + 1];
  if (!S.episodes.length && S.next) return { src: S.next, name: 'بعدی' };
  return null;
}

let nextTimer = null;
function playNextEp(auto) {
  const nx = nextEp();
  if (!nx) { if (auto) toast('اپیزود بعدی موجود نیست'); return; }
  if (!auto) { playEp(currentEpIndex() + 1); return; }
  if (!S.autoNext) { showNextCard(nx, 0); return; }
  showNextCard(nx, 5);
  let left = 5;
  clearInterval(nextTimer);
  nextTimer = setInterval(() => {
    left--;
    if (!video.paused) { $('nextCard').classList.remove('on'); clearInterval(nextTimer); return; }
    $('nx-timer').textContent = 'پخش خودکار در ' + fa(left) + '…';
    if (left <= 0) { clearInterval(nextTimer); $('nextCard').classList.remove('on'); playEp(currentEpIndex() + 1); }
  }, 1000);
}
function showNextCard(nx, secs) {
  $('nx-img').src = S.poster || '';
  $('nx-title').textContent = nx.name || 'اپیزود بعدی';
  $('nx-timer').textContent = secs ? 'پخش خودکار در ' + fa(secs) + '…' : '';
  $('nextCard').classList.add('on');
}
$('nx-go').addEventListener('click', () => { $('nextCard').classList.remove('on'); playEp(currentEpIndex() + 1); });

/* ---------- versions ---------- */
function renderVersPanel() {
  const box = $('versList');
  if (!S.versions.length) { box.innerHTML = '<div class="empty">نسخه دیگری اضافه نشده</div>'; return; }
  box.innerHTML = S.versions.map((v, i) => `
    <button class="ver-item ${v.src === S.src ? 'active' : ''}" data-i="${i}">
      <span class="vi-badge">${v.badge || '🎬'}</span>
      <span style="flex:1">${esc(v.name)}</span>
      ${v.src === S.src ? '<span style="color:var(--accent)">✓</span>' : ''}
    </button>`).join('');
  box.querySelectorAll('.ver-item').forEach(b => b.addEventListener('click', () => {
    const v = S.versions[+b.dataset.i];
    if (v.src === S.src) { $('panel-vers').classList.remove('on'); return; }
    const pos = video.currentTime;
    S.src = v.src; $('panel-vers').classList.remove('on');
    loadSource(v.src, true);
    video.addEventListener('loadedmetadata', function once() {
      if (pos > 0 && pos < video.duration - 5) video.currentTime = pos;
      video.removeEventListener('loadedmetadata', once);
    });
    toast('نسخه: ' + v.name);
  }));
}

/* ---------- menu (screenshot / AB / sleep / skip intro / stats) ---------- */
$('btn-menu').addEventListener('click', e => togglePop('pop-menu', e.currentTarget));
$('m-screenshot').addEventListener('click', () => { screenshot(); togglePop('pop-menu'); });
$('m-ab').addEventListener('click', () => { abToggle(); togglePop('pop-menu'); });
$('m-sleep').addEventListener('click', e => { togglePop('pop-sleep', e.currentTarget); $('pop-menu').classList.remove('on'); });
$('m-skipintro').addEventListener('click', () => {
  S.skipIntroSec = Math.max(0, Math.round(video.currentTime));
  localStorage.setItem('cp-skipintro', String(S.skipIntroSec));
  toast('رد کردن اینترو تا دقیقه ' + fmt(S.skipIntroSec) + ' تنظیم شد');
  togglePop('pop-menu');
});
$('m-stats').addEventListener('click', () => { renderStats(); togglePop('pop-stats', $('btn-menu')); $('pop-menu').classList.remove('on'); });
$('m-settings').addEventListener('click', () => { togglePanel('panel-settings'); togglePop('pop-menu'); });

$('skipIntro').addEventListener('click', () => {
  if (S.skipIntroSec > 0) { video.currentTime = S.skipIntroSec; $('skipIntro').classList.remove('on'); }
});

/* screenshot */
function screenshot() {
  try {
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    const a = document.createElement('a');
    a.download = (S.title || 'cineplay') + '-' + fmt(video.currentTime).replace(/:/g, '-') + '.png';
    a.href = c.toDataURL('image/png');
    a.click();
    toast('اسکرین‌شات ذخیره شد 📷');
  } catch (e) { toast('به‌خاطر CORS امکان اسکرین‌شات نیست'); }
}

/* AB repeat */
function abToggle() {
  if (S.abA < 0) { S.abA = video.currentTime; $('abBadge').classList.add('on'); $('abA').textContent = fmt(S.abA); $('abB').textContent = '--:--'; toast('نقطه A: ' + fmt(S.abA)); }
  else if (S.abB < 0) { S.abB = video.currentTime; $('abB').textContent = fmt(S.abB); toast('نقطه B: ' + fmt(S.abB) + ' — تکرار فعال'); }
  else { S.abA = S.abB = -1; $('abBadge').classList.remove('on'); toast('تکرار A-B خاموش شد'); }
}

/* sleep timer */
document.querySelectorAll('#pop-sleep .opt').forEach(b => b.addEventListener('click', () => {
  const v = b.dataset.sleep;
  $('pop-sleep').classList.remove('on');
  if (v === '0') { S.sleepAt = 0; S.sleepEnd = false; $('sleepBadge').classList.remove('on'); toast('تایمر خواب خاموش شد'); return; }
  if (v === 'end') { S.sleepEnd = true; S.sleepAt = 0; $('sleepBadge').classList.add('on'); $('sleepVal').textContent = 'پایان ویدیو'; toast('پایان ویدیو → بستن پلیر'); return; }
  S.sleepEnd = false; S.sleepAt = Date.now() + (+v) * 60000;
  $('sleepBadge').classList.add('on'); $('sleepVal').textContent = fa(v) + ' دقیقه';
  toast('خاموشی خودکار: ' + fa(v) + ' دقیقه');
}));
setInterval(() => {
  if (S.sleepAt && Date.now() >= S.sleepAt) {
    S.sleepAt = 0; $('sleepBadge').classList.remove('on');
    video.pause(); closePlayer();
  } else if (S.sleepAt) {
    const left = Math.ceil((S.sleepAt - Date.now()) / 60000);
    $('sleepVal').textContent = fa(left) + ' دقیقه';
  }
}, 5000);

/* ---------- stats ---------- */
function renderStats() {
  let size = '--', level = '--', bitrate = '--';
  try {
    if (S.hls) {
      level = S.hls.levels[S.hls.currentLevel];
      if (level) { size = level.height + 'p'; bitrate = Math.round(level.bitrate / 1000) + ' kbps'; }
    } else if (video.videoHeight) { size = video.videoHeight + 'p'; }
  } catch (e) { }
  let buf = '∞';
  try { if (video.buffered.length && S.duration) buf = Math.round(video.buffered.end(video.buffered.length - 1) - video.currentTime) + 's'; } catch (e) { }
  const rows = [
    ['رزولوشن', size], ['کیفیت HLS', typeof level === 'object' && level ? (level.height || '') + 'p @' + Math.round((level.bitrate || 0) / 1000) + 'kbps' : '—'],
    ['بافر جلو', buf], ['سرعت فعلی', video.playbackRate + '×'],
    ['کیفیت تصویر', (video.videoWidth || '—') + '×' + (video.videoHeight || '—')],
    ['حجم بافر', (() => { try { return Math.round((video.buffered.end(video.buffered.length - 1) / (S.duration || 1)) * 100) + '%'; } catch (e) { return '—'; } })()],
    ['موقعیت', fmt(video.currentTime) + ' / ' + fmt(S.duration)]
  ];
  $('statsBody').innerHTML = rows.map(r => `<div class="row"><b>${r[0]}</b><span>${esc(String(r[1]))}</span></div>`).join('');
}

/* ---------- settings ---------- */
$('syncMinus').addEventListener('click', () => Subs.offset(-0.5));
$('syncPlus').addEventListener('click', () => Subs.offset(0.5));
$('subSize').addEventListener('input', e => Subs.style({ size: +e.target.value }));
$('subColor').addEventListener('input', e => Subs.style({ color: e.target.value }));
$('subPos').addEventListener('input', e => Subs.style({ pos: +e.target.value }));
document.querySelectorAll('#subBgSeg button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#subBgSeg button').forEach(x => x.classList.toggle('active', x === b));
  Subs.style({ bg: b.dataset.bg });
}));
document.querySelectorAll('#autoNextSeg button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#autoNextSeg button').forEach(x => x.classList.toggle('active', x === b));
  S.autoNext = b.dataset.v === '1'; localStorage.setItem('cp-autonext', S.autoNext ? '1' : '0');
}));
document.querySelectorAll('#zoomSeg button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#zoomSeg button').forEach(x => x.classList.toggle('active', x === b));
  video.className = b.dataset.z === 'fit' ? '' : 'zoom-' + b.dataset.z;
}));

/* ---------- UI auto-hide ---------- */
function showUI(ms = 3000) {
  stage.classList.remove('hide-ui');
  clearTimeout(S.uiTimer);
  if (ms < 999999) S.uiTimer = setTimeout(() => { if (!video.paused) stage.classList.add('hide-ui'); }, ms);
}
function hideUISoon() { showUI(3000); }
stage.addEventListener('mousemove', () => showUI());
stage.addEventListener('touchstart', () => showUI(), { passive: true });

/* ---------- keyboard ---------- */
document.addEventListener('keydown', e => {
  if (!$('player').classList.contains('on')) return;
  if (e.target.matches('input, textarea, select')) return;
  const k = e.key;
  if (k === ' ' || k === 'k') { e.preventDefault(); togglePlay(); }
  else if (k === 'ArrowRight') { video.currentTime = clamp(video.currentTime - 10, 0, S.duration); toast('⏪ ۱۰ ثانیه'); }
  else if (k === 'ArrowLeft') { video.currentTime = clamp(video.currentTime + 10, 0, S.duration); toast('⏩ ۱۰ ثانیه'); }
  else if (k === 'ArrowUp') { video.volume = clamp(video.volume + .1, 0, 1); video.muted = false; updVolIc(); showOSD('🔊', video.volume); }
  else if (k === 'ArrowDown') { video.volume = clamp(video.volume - .1, 0, 1); updVolIc(); showOSD('🔊', video.volume); }
  else if (k === 'f') toggleFull();
  else if (k === 'm') { video.muted = !video.muted; updVolIc(); }
  else if (k === 'n') playNextEp(false);
  else if (k === 's') screenshot();
  else if (k === 'p') $('btn-pip').click();
  else if (k === '[') Subs.offset(-0.5);
  else if (k === ']') Subs.offset(0.5);
  else if (k === 'Escape') { if (document.fullscreenElement) document.exitFullscreen(); else closePlayer(); }
});

/* ---------- mobile gestures: volume / brightness swipe ---------- */
let gest = null;
stage.addEventListener('touchstart', e => {
  if (e.target.closest('.controls, .topbar, .panel, .pop')) { gest = null; return; }
  const t = e.touches[0];
  gest = { x: t.clientX, y: t.clientY, w: stage.clientWidth, vol: video.volume, bright: 1, side: t.clientX / stage.clientWidth > .5 ? 'r' : 'l' };
}, { passive: true });
stage.addEventListener('touchmove', e => {
  if (!gest || !e.touches.length) return;
  const t = e.touches[0];
  const dy = gest.y - t.clientY;
  if (Math.abs(dy) < 12 && Math.abs(t.clientX - gest.x) < 12) return;
  const d = clamp(dy / (stage.clientHeight * .7), -1, 1);
  if (gest.side === 'r') {
    video.volume = clamp(gest.vol + d, 0, 1); video.muted = false; updVolIc();
    showOSD(video.volume === 0 ? '🔇' : '🔊', video.volume);
  } else {
    gest.bright = clamp(1 - d, .25, 1);
    video.style.filter = 'brightness(' + gest.bright + ')';
    showOSD('☀️', (gest.bright - .25) / .75);
  }
}, { passive: true });
stage.addEventListener('touchend', () => { setTimeout(() => hideOSD(), 600); gest = null; }, { passive: true });

let osdT;
function showOSD(ic, val) {
  $('osd-ic').textContent = ic;
  $('osd-fill').style.width = (val * 100) + '%';
  $('osd-val').textContent = fa(Math.round(val * 100)) + '٪';
  $('osd').style.display = 'flex';
  clearTimeout(osdT); osdT = setTimeout(hideOSD, 700);
}
function hideOSD() { $('osd').style.display = 'none'; }

/* ---------- HLS quality + audio tracks ---------- */
function wireQuality() {
  const ql = $('qualityList'), al = $('audioList');
  if (!S.hls) { ql.innerHTML = '<div style="font-size:.7rem;color:var(--text3);padding:4px 8px">این ویدیو HLS نیست — کیفیت انتخابی ندارد</div>'; $('audioHead').style.display = 'none'; al.innerHTML = ''; return; }
  const lv = S.hls.levels || [];
  if (!lv.length) { ql.innerHTML = '<div style="font-size:.7rem;color:var(--text3);padding:4px 8px">کیفیتی پیدا نشد</div>'; return; }
  ql.innerHTML = `<button class="hlrow ${S.hls.autoLevelEnabled ? 'active' : ''}" data-l="-1">خودکار (تطبیقی)</button>` +
    lv.map((l, i) => `<button class="hlrow ${S.hls.currentLevel === i && !S.hls.autoLevelEnabled ? 'active' : ''}" data-l="${i}">${l.height ? l.height + 'p' : (Math.round(l.bitrate / 1000) + 'kbps')}</button>`).reverse().join('');
  ql.querySelectorAll('.hlrow').forEach(b => b.onclick = () => {
    S.hls.currentLevel = +b.dataset.l;
    toast(+b.dataset.l === -1 ? 'کیفیت: خودکار' : 'کیفیت: ' + b.textContent.trim());
    $('pop-quality').classList.remove('on');
    wireQuality();
  });
  // audio tracks (دوبله چندصدا داخل HLS)
  const at = (S.hls.audioTracks && S.hls.audioTracks.length > 1) ? S.hls.audioTracks : null;
  $('audioHead').style.display = at ? '' : 'none';
  al.innerHTML = at ? at.map((t, i) => `<button class="hlrow ${S.hls.audioTrack === i ? 'active' : ''}" data-a="${i}">${esc(t.name || t.lang || 'ترک ' + (i + 1))}</button>`).join('') : '';
  al.querySelectorAll('.hlrow').forEach(b => b.onclick = () => {
    S.hls.audioTrack = +b.dataset.a;
    toast('ترک صدا: ' + b.textContent.trim());
    $('pop-quality').classList.remove('on');
  });
}
// quality button (only HLS)
function updQualityBtn() { $('btn-quality').style.display = S.hls ? '' : 'none'; }

/* ---------- volume boost (WebAudio) ---------- */
let audioCtx = null, gainNode = null, boostOn = false, srcNode = null;
function toggleBoost() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      srcNode = audioCtx.createMediaElementSource(video);
      gainNode = audioCtx.createGain();
      srcNode.connect(gainNode).connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    boostOn = !boostOn;
    gainNode.gain.value = boostOn ? 2.2 : 1;
    $('btn-boost').classList.toggle('active', boostOn);
    toast(boostOn ? 'تقویت صدا: روشن (+۱۲۰٪)' : 'تقویت صدا: خاموش');
  } catch (e) { toast('تقویت صدا پشتیبانی نشد'); }
}
$('btn-boost').addEventListener('click', toggleBoost);

/* ---------- local file playback ---------- */
$('btn-local-file').addEventListener('click', () => $('videoFileInput').click());
$('videoFileInput').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  S.title = S.title || f.name.replace(/\.[^.]+$/, '');
  S.versions = []; S.episodes = []; S.imdb = S.imdb || 'file:' + f.name;
  openPlayer(url, S.title, '', S.imdb);
  S.isLocalFile = true;
  toast('پخش فایل محلی: ' + f.name);
  e.target.value = '';
});

/* drag & drop */
let dragDepth = 0;
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
  e.preventDefault();
  if (ev === 'dragenter') dragDepth++;
  $('dropHint').classList.add('on');
}));
document.addEventListener('dragleave', e => { if (--dragDepth <= 0) { dragDepth = 0; $('dropHint').classList.remove('on'); } });
document.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('dropHint').classList.remove('on');
  const files = [...(e.dataTransfer?.files || [])];
  const vid = files.find(f => /\.(mp4|mkv|webm|mov|avi|m4v)$/i.test(f.name) || f.type.startsWith('video/'));
  const sub = files.filter(f => /\.(srt|vtt|ass)$/i.test(f.name));
  if (sub.length) { sub.forEach(f => Subs.addFile(f)); toast('زیرنویس اضافه شد: ' + sub.map(f => f.name).join(', ')); }
  if (vid) {
    const url = URL.createObjectURL(vid);
    S.versions = []; S.episodes = [];
    S.imdb = S.imdb || 'file:' + vid.name;
    openPlayer(url, vid.name.replace(/\.[^.]+$/, ''), '', S.imdb);
    S.isLocalFile = true;
  }
});

/* ---------- share link ---------- */
$('btn-share').addEventListener('click', async () => {
  const src = $('inp-src').value.trim();
  if (!src) { toast('اول لینک ویدیو را وارد کنید'); return; }
  const p = new URLSearchParams();
  p.set('src', src);
  if ($('inp-title').value.trim()) p.set('title', $('inp-title').value.trim());
  if ($('inp-poster').value.trim()) p.set('poster', $('inp-poster').value.trim());
  if ($('inp-imdb').value.trim()) p.set('imdb', $('inp-imdb').value.trim());
  const link = location.origin + location.pathname + '?' + p.toString();
  try {
    if (navigator.share) await navigator.share({ title: 'سینما پلی', url: link });
    else { await navigator.clipboard.writeText(link); toast('لینک کپی شد ✓'); }
  } catch (e) { }
});

/* ---------- finder wiring ---------- */
$('subs-find').addEventListener('click', () => {
  $('pop-subs').classList.remove('on');
  const fname = S.src.split('/').pop() || S.title;
  SubFinder.open(fname, { title: S.title });
});

/* ---------- Wake Lock (no sleep while playing) ---------- */
let wakeLock = null;
async function reqWakeLock() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('video'); wakeLock.addEventListener('release', () => wakeLock = null); } } catch (e) { }
}
video.addEventListener('play', reqWakeLock);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !video.paused) reqWakeLock(); });

/* ---------- Media Session (locksreen / hardware keys) ---------- */
if ('mediaSession' in navigator) {
  const setMS = () => {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: S.title || 'پخش آنلاین',
        artist: S.episodes.length && S.curEp >= 0 ? 'فصل ' + S.episodes[S.curEp].season + ' قسمت ' + S.episodes[S.curEp].ep : 'سینما پلی',
        artwork: S.poster ? [{ src: S.poster, sizes: '512x512', type: 'image/jpeg' }] : []
      });
      navigator.mediaSession.setActionHandler('play', () => video.play());
      navigator.mediaSession.setActionHandler('pause', () => video.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => { const c = currentEpIndex(); if (c > 0) playEp(c - 1); });
      navigator.mediaSession.setActionHandler('nexttrack', () => playNextEp(false));
      navigator.mediaSession.setActionHandler('seekbackward', () => video.currentTime = clamp(video.currentTime - 10, 0, S.duration));
      navigator.mediaSession.setActionHandler('seekforward', () => video.currentTime = clamp(video.currentTime + 10, 0, S.duration));
    } catch (e) { }
  };
  video.addEventListener('play', setMS);
  video.addEventListener('loadedmetadata', setMS);
}

/* ---------- mobile back button closes player (not page) ---------- */
let backPushed = false;
function pushBackState() {
  if (backPushed) return;
  backPushed = true;
  history.pushState({ cineplay: true }, '');
}
window.addEventListener('popstate', e => {
  if ($('player').classList.contains('on')) {
    closePlayer();
    backPushed = false;
    if (!e.state) history.pushState({ cineplay: true }, ''), backPushed = true;
  }
});

/* ---------- boot ---------- */
(function boot() {
  renderRecents();
  const p = parseParams();
  if (p) {
    if (p.raw && p.raw.versions) S.versions = p.raw.versions.map(v => typeof v === 'string' ? { name: v, src: v } : v);
    if (p.raw && p.raw.episodes) S.episodes = p.raw.episodes;
    if (p.sub) Subs.addRemote([p.sub]);
    if (p.next) S.next = p.next;
    openPlayer(p.src, p.title, p.poster, p.imdb);
  }
  updQualityBtn();
})();
