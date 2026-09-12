/* ═══════════════════════════════════════════════════════════
   سینما پلی — زیرنویس‌ها: پارسر SRT/VTT/ASS + رندر سفارشی
   ═══════════════════════════════════════════════════════════ */
'use strict';

const Subs = (() => {
  const video = document.getElementById('video');
  const render = document.getElementById('subRender');

  const state = {
    tracks: [],        // [{name, cues:[{start,end,text}], src}]
    active: -1,
    offset: 0,
    style: {
      size: parseInt(localStorage.getItem('cp-sub-size') || '22'),
      color: localStorage.getItem('cp-sub-color') || '#ffffff',
      bg: localStorage.getItem('cp-sub-bg') || 'shadow',
      pos: parseInt(localStorage.getItem('cp-sub-pos') || '0')
    }
  };

  /* ---------- parsers ---------- */
  function pad(n, len = 3) { return String(n).padStart(len, '0'); }
  const ms2sec = ms => ms / 1000;

  function timeToSec(t) {
    // 00:01:02,500  |  00:01:02.500  |  00:01:02:500
    const m = t.trim().match(/(\d+):(\d+):(\d+)[.,:](\d+)/) || t.trim().match(/(\d+):(\d+):(\d+)/);
    if (!m) return 0;
    const s = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    return m[4] !== undefined ? s + (+('0.' + m[4])) : s;
  }

  function parseSRT(text) {
    const cues = [];
    text = text.replace(/^\uFEFF/, '').replace(/\r/g, '');
    const blocks = text.split(/\n\s*\n/);
    for (const b of blocks) {
      const lines = b.split('\n').filter(l => l.trim());
      if (lines.length < 2) continue;
      const tl = lines.find(l => /-->/.test(l));
      if (!tl) continue;
      const [a, z] = tl.split('-->');
      const textLines = lines.filter(l => l !== tl && !/^\d+$/.test(l.trim()));
      cues.push({ start: timeToSec(a), end: timeToSec(z), text: textLines.join('\n') });
    }
    return cues;
  }

  function parseVTT(text) {
    text = text.replace(/^\uFEFF/, '').replace(/\r/g, '');
    // strip style blocks & headers
    text = text.replace(/^WEBVTT.*$/m, '').replace(/^STYLE[\s\S]*?$/m, m => m.split('\n').length > 2 ? '' : m);
    const cues = [];
    const blocks = text.split(/\n\s*\n/);
    for (const b of blocks) {
      const lines = b.split('\n').filter(l => l.trim());
      if (lines.length < 2) continue;
      const tl = lines.find(l => /-->/.test(l));
      if (!tl) continue;
      const [a, z] = tl.split('-->');
      cues.push({
        start: timeToSec(a),
        end: timeToSec(z.split(' ').filter(x => !x.includes('=')).join('')),
        text: lines.filter(l => l !== tl).join('\n')
      });
    }
    return cues;
  }

  function parseASS(text) {
    // فقط Rozhd: [Events] — متن‌ها، بدون استایل‌های پیچیده
    const cues = [];
    const lines = text.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
    let inEvents = false, fmt = [];
    for (const l of lines) {
      if (/^\[Events\]/i.test(l)) { inEvents = true; continue; }
      if (/^\[/.test(l)) { inEvents = false; continue; }
      if (!inEvents) continue;
      if (/^Format:/i.test(l)) { fmt = l.replace(/^Format:\s*/i, '').split(',').map(x => x.trim().toLowerCase()); continue; }
      const m = l.match(/^Dialogue:\s*(.*)$/i);
      if (!m) continue;
      const parts = m[1].split(',');
      const get = key => {
        const i = fmt.indexOf(key);
        return i >= 0 && parts[i] !== undefined ? parts[i] : '';
      };
      const text = (parts.slice(fmt.indexOf('text') >= 0 ? fmt.indexOf('text') : 9).join(',') || '')
        .replace(/\{[^}]*\}/g, '')          // {\i1} و غیره
        .replace(/\\N|\\n/g, '\n')
        .trim();
      const start = timeToSec(get('start') || parts[1] || '0');
      const end = timeToSec(get('end') || parts[2] || '0');
      if (text) cues.push({ start, end, text });
    }
    return cues;
  }

  function detectAndParse(text, name) {
    if (/^\s*\[Script Info\]/i.test(text) || /^\s*Dialogue:/im.test(text)) return parseASS(text);
    if (/^WEBVTT/m.test(text)) return parseVTT(text);
    return parseSRT(text);
  }

  /* ---------- load from url / file ---------- */
  async function addRemote(urls) {
    for (const u of (Array.isArray(urls) ? urls : [urls])) {
      try {
        const r = await fetch(u);
        if (!r.ok) throw new Error();
        const t = await r.text();
        addParsed(t, u.split('/').pop() || 'زیرنویس');
      } catch (e) { console.warn('sub load fail', u); }
    }
    refresh();
  }

  function addFile(file) {
    const reader = new FileReader();
    reader.onload = () => { addParsed(reader.result, file.name); refresh(); };
    reader.readAsText(file, 'utf-8');
  }

  function addParsed(text, name) {
    const cues = detectAndParse(text, name);
    if (!cues.length) return false;
    state.tracks.push({ name: name.replace(/\.(srt|vtt|ass)$/i, ''), cues, src: 'local' });
    if (state.active < 0) state.active = state.tracks.length - 1;
    return true;
  }

  /* ---------- rendering ---------- */
  let rafId = null;
  function tick() {
    rafId = requestAnimationFrame(tick);
    if (state.active < 0 || !video.currentTime) { render.textContent = ''; return; }
    const t = video.currentTime + state.offset;
    const tr = state.tracks[state.active];
    const cue = tr && tr.cues.find(c => t >= c.start && t <= c.end);
    render.textContent = '';
    if (cue) {
      const d = document.createElement('div');
      d.className = 'cue';
      d.style.fontSize = state.style.size + 'px';
      d.style.color = state.style.color;
      d.style.fontFamily = "'Vazirmatn',sans-serif";
      d.style.textShadow = state.style.bg === 'shadow' ? '0 2px 6px rgba(0,0,0,.9)' : 'none';
      d.style.background = state.style.bg === 'box' ? 'rgba(0,0,0,.72)' : 'transparent';
      d.style.borderRadius = '6px';
      d.style.padding = state.style.bg === 'box' ? '4px 10px' : '2px 6px';
      d.style.bottom = state.style.pos + 'px';
      d.style.position = 'relative';
      d.style.whiteSpace = 'pre-wrap';
      d.textContent = cue.text;
      render.appendChild(d);
    }
  }
  if (!rafId) tick();

  /* ---------- controls ---------- */
  function refresh() {
    renderPopover();
    renderManage();
  }

  function renderPopover() {
    const box = document.getElementById('subsPopList');
    if (!box) return;
    if (!state.tracks.length) { box.innerHTML = '<div style="font-size:.7rem;color:var(--text3);padding:6px 8px">زیرنویسی اضافه نشده</div>'; return; }
    box.innerHTML = state.tracks.map((t, i) =>
      `<button class="opt ${i === state.active ? 'active' : ''}" data-sub="${i}">${/fa|فار|persian|farsi/i.test(t.name) ? '🇮🇷 ' : ''}${t.name} (${t.cues.length})</button>`
    ).join('');
    box.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => {
      state.active = +b.dataset.sub;
      document.getElementById('pop-subs').classList.remove('on');
      toast('زیرنویس: ' + state.tracks[state.active].name);
      refresh();
    });
  }

  function renderManage() {
    const box = document.getElementById('subsList');
    if (!box) return;
    if (!state.tracks.length) { box.innerHTML = '<div class="empty">هنوز زیرنویسی اضافه نشده — از منوی زیرنویس فایل یا لینک اضافه کنید</div>'; return; }
    box.innerHTML = state.tracks.map((t, i) => `
      <div class="ver-item" style="cursor:default">
        <span class="vi-badge">💬</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.name} <span style="color:var(--text3);font-size:.65rem">(${t.cues.length} خط)</span></span>
        ${i === state.active ? '<span style="color:var(--accent);font-size:.7rem;font-weight:800">فعال</span>' : ''}
        <button class="icon-btn" data-subon="${i}" title="فعال" style="width:30px;height:30px">▶</button>
        <button class="icon-btn" data-subdel="${i}" title="حذف" style="width:30px;height:30px">🗑</button>
      </div>`).join('');
    box.querySelectorAll('[data-subon]').forEach(b => b.onclick = () => { state.active = +b.dataset.subon; refresh(); });
    box.querySelectorAll('[data-subdel]').forEach(b => b.onclick = () => {
      const i = +b.dataset.subdel;
      state.tracks.splice(i, 1);
      if (state.active >= state.tracks.length) state.active = state.tracks.length - 1;
      refresh();
    });
  }

  /* toast helper (defined in player.js — safe fallback) */
  function toast(m) { const t = document.getElementById('toast'); if (t) { t.textContent = m; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 2000); } }

  /* ---------- public ---------- */
  return {
    addRemote, addFile, addParsed,
    reset() { state.tracks = []; state.active = -1; render.textContent = ''; refresh(); },
    off() { state.active = -1; render.textContent = ''; refresh(); },
    offset(d) {
      state.offset = Math.round((state.offset + d) * 10) / 10;
      const v = document.getElementById('syncVal');
      if (v) v.textContent = state.offset.toFixed(1);
      toast('سنکرون: ' + (state.offset > 0 ? '+' : '') + state.offset + 's');
    },
    style(patch) {
      Object.assign(state.style, patch);
      localStorage.setItem('cp-sub-size', state.style.size);
      localStorage.setItem('cp-sub-color', state.style.color);
      localStorage.setItem('cp-sub-bg', state.style.bg);
      localStorage.setItem('cp-sub-pos', state.style.pos);
      // keep settings panel in sync
      const m = { size: 'subSize', color: 'subColor', pos: 'subPos' };
      for (const k in m) { const el = document.getElementById(m[k]); if (el && patch[k] !== undefined) el.value = patch[k]; }
    },
    get active() { return state.active; },
    get tracks() { return state.tracks; }
  };
})();

/* file input wiring (rendered by index.html) */
document.getElementById('subs-file').addEventListener('click', () => {
  document.getElementById('subFileInput').click();
  document.getElementById('pop-subs').classList.remove('on');
});
document.getElementById('subFileInput').addEventListener('change', e => {
  if (e.target.files[0]) Subs.addFile(e.target.files[0]);
  e.target.value = '';
});
document.getElementById('subs-url').addEventListener('click', () => {
  const u = prompt('لینک زیرنویس (SRT / VTT):');
  if (u && u.trim()) Subs.addRemote(u.trim());
  document.getElementById('pop-subs').classList.remove('on');
});
document.getElementById('subs-off').addEventListener('click', () => { Subs.off(); document.getElementById('pop-subs').classList.remove('on'); toast('زیرنویس خاموش شد'); });
document.getElementById('subs-manage').addEventListener('click', () => {
  document.getElementById('pop-subs').classList.remove('on');
  document.getElementById('panel-subs').classList.add('on');
});
document.getElementById('btn-subs').addEventListener('click', e => {
  Subs.refresh ? null : null;
  document.getElementById('pop-subs').classList.add('on');
  const r = e.currentTarget.getBoundingClientRect();
  const p = document.getElementById('pop-subs');
  p.style.left = clamp2(r.left + r.width / 2 - 110, 8, innerWidth - 240) + 'px';
  if (typeof Subs.refresh === 'function') Subs.refresh();
});
function clamp2(v, a, b) { return Math.min(b, Math.max(a, v)); }
