/* Kỳ Đạo – ứng dụng phía trình duyệt */
(function () {
  'use strict';
  const X = window.Xiangqi, RK = window.Ranks;

  // ═════════════════════ Tiện ích ═════════════════════
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : String(c));
    }
    return el;
  }

  const LS = {
    get(k, d) { try { const v = localStorage.getItem('kydao_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('kydao_' + k, JSON.stringify(v)); } catch (e) { /* bỏ qua */ } },
    del(k) { try { localStorage.removeItem('kydao_' + k); } catch (e) { /* bỏ qua */ } }
  };

  const settings = Object.assign({ han: true, sound: true }, LS.get('settings', {}));
  const saveSettings = () => LS.set('settings', settings);

  const colorName = c => (c === 'r' ? 'Đỏ' : 'Đen');
  const VAR = X.VARIANTS;
  const LEVELS = { 1: 'Dễ', 2: 'Vừa', 3: 'Khó', 4: 'Đại sư' };
  const TIME_OPTS = [0, 1, 3, 5, 10, 15, 20, 30, 45, 60];
  const INC_OPTS = [0, 2, 3, 5, 10, 15, 20, 30];
  const PIECE_VAL = { R: 900, H: 400, C: 450, A: 200, E: 200, P: 100, K: 0 };

  function fmtClock(ms) {
    if (ms == null) return '∞';
    ms = Math.max(0, ms);
    if (ms < 10000) return (Math.floor(ms / 100) / 10).toFixed(1);
    const s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  const fmtTimeCtl = (t, inc) => (t ? t + ' phút' + (inc ? ' +' + inc + 's' : '') : 'Không giới hạn');
  function fmtDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }
  function hue(name) {
    let x = 7;
    for (const ch of String(name || '?')) x = (x * 31 + ch.codePointAt(0)) % 360;
    return x;
  }
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ═════════════════════ Âm thanh (tổng hợp, không cần file) ═════════════════════
  const Sound = (() => {
    let ctx = null;
    function ac() {
      if (!settings.sound) return null;
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        ctx = new C();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(freq, dur, vol, type) {
      const a = ac();
      if (!a) return;
      const t = a.currentTime, o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    function wood(vol, freq) {
      const a = ac();
      if (!a) return;
      const len = 0.07, buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 5);
      const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      src.buffer = buf;
      f.type = 'bandpass'; f.frequency.value = freq || 1500; f.Q.value = 1.4;
      g.gain.value = vol;
      src.connect(f).connect(g).connect(a.destination);
      src.start();
    }
    const seq = (notes, gap, dur, vol) => notes.forEach((f, i) => setTimeout(() => tone(f, dur, vol), i * gap));
    return {
      move() { wood(1.4, 1500); tone(380, 0.06, 0.08, 'triangle'); },
      capture() { wood(2, 900); tone(220, 0.14, 0.16, 'triangle'); },
      check() { seq([880, 1175], 110, 0.16, 0.09); },
      select() { tone(760, 0.04, 0.035); },
      start() { seq([523, 659, 784], 90, 0.18, 0.07); },
      win() { seq([523, 659, 784, 1047], 120, 0.3, 0.09); },
      lose() { seq([392, 330, 262], 160, 0.35, 0.08); },
      notify() { seq([988, 1319], 90, 0.14, 0.06); }
    };
  })();

  // ═════════════════════ Thông báo & hộp thoại ═════════════════════
  function toast(msg, kind, opts) {
    opts = opts || {};
    const el = h('div', { class: 'toast ' + (kind || 'info'), role: 'status' }, h('div', null, msg));
    let closed = false;
    const close = () => { if (closed) return; closed = true; el.remove(); if (opts.onClose) opts.onClose(); };
    if (opts.actions) {
      el.append(h('div', { class: 't-acts' }, opts.actions.map(a =>
        h('button', { class: 'btn sm ' + (a.kind || ''), onclick: () => { if (a.onClick) a.onClick(); close(); } }, a.label))));
    } else el.addEventListener('click', close);
    $('#toasts').append(el);
    const ms = opts.timeout === 0 ? 0 : (opts.timeout || 4200);
    if (ms) setTimeout(close, ms);
    return { close, el };
  }

  function modal(o) {
    const back = h('div', { class: 'modal-back' });
    const title = h('h3', null, o.title || '');
    const box = h('div', { class: 'modal' + (o.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' });
    let closed = false;
    const close = v => {
      if (closed) return;
      closed = true;
      back.remove();
      document.removeEventListener('keydown', onKey);
      if (o.onClose) o.onClose(v);
    };
    const onKey = e => { if (e.key === 'Escape' && o.dismissable !== false) close(); };
    box.append(h('div', { class: 'modal-head' }, title,
      o.dismissable === false ? null : h('button', { class: 'btn ghost icon-btn', type: 'button', 'aria-label': 'Đóng', onclick: () => close() }, '✕')));
    box.append(h('div', { class: 'modal-body' }, o.body));
    const foot = h('div', { class: 'modal-foot' });
    for (const a of o.actions || []) {
      foot.append(h('button', {
        class: 'btn ' + (a.kind || ''), type: 'button',
        onclick: () => { const r = a.onClick ? a.onClick() : undefined; if (r !== false) close(a.value); }
      }, a.label));
    }
    if (o.actions && o.actions.length) box.append(foot);
    back.append(box);
    back.addEventListener('mousedown', e => { if (e.target === back && o.dismissable !== false) close(); });
    document.addEventListener('keydown', onKey);
    $('#modal-root').append(back);
    setTimeout(() => { const f = box.querySelector('.modal-body input:not([type=checkbox]), .modal-body select'); if (f) f.focus(); }, 40);
    return { close, box, title };
  }

  function confirmBox(title, text, okLabel, kind) {
    return new Promise(resolve => {
      modal({
        title, body: h('p', { style: 'margin:0' }, text),
        actions: [{ label: 'Hủy', kind: 'ghost' }, { label: okLabel || 'Đồng ý', kind: kind || 'primary', onClick: () => resolve(true) }],
        onClose: () => resolve(false)
      });
    });
  }

  function field(label, control, extra) {
    return h('div', { class: 'field' + (extra ? ' ' + extra : '') }, h('label', null, label), control);
  }

  function segControl(options, value, onChange) {
    const seg = h('div', { class: 'seg' });
    let cur = value;
    for (const [v, label] of options) {
      const b = h('button', { type: 'button', class: v === cur ? 'active' : '' }, label);
      b.addEventListener('click', () => {
        cur = v;
        $$('button', seg).forEach(x => x.classList.toggle('active', x === b));
        if (onChange) onChange(v);
      });
      seg.append(b);
    }
    seg.getValue = () => cur;
    return seg;
  }

  function selectBox(options, value) {
    const s = h('select', { class: 'input' });
    for (const [v, label] of options) s.append(h('option', { value: String(v) }, label));
    s.value = String(value);
    return s;
  }

  // ═════════════════════ Thành phần hiển thị người chơi ═════════════════════
  const starStr = n => '★'.repeat(n);
  function rankBadgeTier(i) {
    const t = RK.TIERS[Math.max(0, Math.min(RK.TIERS.length - 1, i | 0))];
    return h('span', { class: 'rank-badge', style: '--rc:' + t.color, title: t.name }, t.rankName, h('span', { class: 'stars' }, starStr(t.star)));
  }
  const rankBadge = pts => rankBadgeTier(RK.tierIndex(pts || 0));
  const avatar = (name, cls) => h('span', { class: 'avatar ' + (cls || ''), style: '--h:' + hue(name) }, String(name || '?').slice(0, 1));
  const titleChip = name => (name ? h('span', { class: 'title-chip' }, name) : null);
  const userLink = name => h('span', { class: 'ulink', onclick: e => { e.stopPropagation(); openProfile(name); } }, name);
  function miniPiece(col, t, small) {
    return h('span', { class: 'mini-piece ' + (col === 'r' ? 'red' : 'black') + (small ? ' sm' : ''), title: X.NAMES[t] }, settings.han ? X.HAN[col][t] : X.SHORT[t]);
  }
  const STATUS_TEXT = { playing: 'Đang chơi', room: 'Trong phòng', queue: 'Đang tìm trận', online: 'Trực tuyến', offline: 'Ngoại tuyến' };
  const dotClass = st => 'online-dot' + (st === 'playing' ? ' play' : st === 'room' ? ' room' : st === 'offline' ? '' : ' on');

  // ═════════════════════ Trạng thái ═════════════════════
  const S = {
    token: LS.get('token', null), me: null, view: 'home', stats: null,
    rooms: [], roomFilter: 'all', roomVariant: 'all', roomQuery: '',
    friends: { friends: [], incoming: [], outgoing: [] },
    chIn: new Map(), chOut: new Map(), chToasts: new Map(),
    queue: null, room: null, roomRecvAt: 0, chat: [], unread: 0,
    leaderboard: null, rankTab: 'board', profile: null, profileName: null, search: [],
    authDlg: null, pendingJoin: null, explicitAuth: false
  };

  // ═════════════════════ Kết nối máy chủ ═════════════════════
  function setConn(state, text) {
    const el = $('#conn');
    el.className = 'conn' + (state === 'on' ? ' on' : state === 'off' ? ' off' : '');
    el.title = text;
  }

  const Net = {
    ws: null, ready: false, handlers: {}, backoff: 600,
    available() { return location.protocol === 'http:' || location.protocol === 'https:'; },
    connect() {
      if (!this.available()) {
        setConn('off', 'Đang mở trực tiếp từ file – hãy chạy "node server.js" để chơi trực tuyến');
        return;
      }
      setConn('wait', 'Đang kết nối máy chủ…');
      let ws;
      try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); }
      catch (e) { return this.retry(); }
      this.ws = ws;
      ws.onopen = () => {
        this.ready = true;
        this.backoff = 600;
        setConn('on', 'Đã kết nối máy chủ');
        this.send({ t: 'hello', token: S.token });
        if (S.view === 'rooms') this.send({ t: 'room_watch', on: true });
      };
      ws.onmessage = e => {
        let m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        const fn = this.handlers[m.t];
        if (fn) { try { fn(m); } catch (err) { console.error(err); } }
      };
      ws.onclose = () => {
        const was = this.ready;
        this.ready = false;
        this.ws = null;
        setConn('off', 'Mất kết nối – đang thử lại…');
        if (was) onDisconnected();
        this.retry();
      };
    },
    retry() { setTimeout(() => this.connect(), this.backoff); this.backoff = Math.min(8000, this.backoff * 1.6); },
    send(m) {
      if (this.ready && this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(m)); return true; }
      return false;
    },
    on(t, fn) { this.handlers[t] = fn; }
  };

  function send(m) {
    if (Net.send(m)) return true;
    toast(Net.available() ? 'Chưa kết nối được máy chủ, vui lòng thử lại sau giây lát' : 'Hãy chạy server (node server.js) và mở http://localhost:3000 để chơi trực tuyến', 'warn', { timeout: 6000 });
    return false;
  }

  function needLogin() {
    if (S.me) return false;
    openAuth('login');
    return true;
  }

  function onDisconnected() {
    S.queue = null;
    renderQueuePill();
    toast('Mất kết nối máy chủ – đang kết nối lại…', 'warn');
  }

  // ── Xử lý tin nhắn từ server ──
  Net.on('stats', m => { S.stats = m.stats; renderHeroStats(); renderRoomsSub(); });
  Net.on('guest', () => {
    if (S.token) { S.token = null; LS.del('token'); }
    S.me = null;
    renderHeader(); renderHome(); renderFriends();
  });
  Net.on('auth_ok', m => {
    S.token = m.token;
    LS.set('token', m.token);
    S.me = m.me;
    if (S.authDlg) { S.authDlg.close(); S.authDlg = null; }
    if (S.explicitAuth) { toast('Chào mừng, ' + m.me.name + '!', 'success'); S.explicitAuth = false; }
    renderHeader(); renderHome(); renderFriends();
    if (S.view === 'rank') renderRank();
  });
  Net.on('auth_err', m => { if (S.authDlg) S.authDlg.err.textContent = m.msg; else toast(m.msg, 'error'); });
  Net.on('me', m => { S.me = m.me; renderHeader(); renderHome(); if (S.view === 'rank') renderRank(); });
  Net.on('error', m => {
    if (m.code === 'password') return askRoomPassword(m.roomId, m.msg);
    if (m.code === 'login') { openAuth('login'); return; }
    toast(m.msg, 'error');
  });
  Net.on('toast', m => { toast(m.msg, m.kind); if (m.kind === 'friend' || m.kind === 'warn') Sound.notify(); });
  Net.on('friends', m => {
    S.friends = m;
    const q = $('#friend-search').value.trim();
    if (q) Net.send({ t: 'user_search', q }); // làm mới trạng thái quan hệ trong kết quả tìm kiếm
    renderFriends(); renderHeader();
    if (Game.mode === 'online') Game.renderPeople();
  });
  Net.on('challenge_in', m => {
    const ch = m.ch;
    if (S.chIn.has(ch.id)) return;
    S.chIn.set(ch.id, ch);
    Sound.notify();
    const t = toast(ch.from + ' thách đấu bạn: ' + VAR[ch.variant] + ', ' + fmtTimeCtl(ch.time, ch.inc) + (ch.rated ? ', tính điểm' : ', giao hữu'), 'challenge', {
      timeout: 0,
      actions: [
        { label: 'Từ chối', kind: 'ghost', onClick: () => send({ t: 'challenge_respond', id: ch.id, accept: false }) },
        { label: 'Nhận lời', kind: 'primary', onClick: () => send({ t: 'challenge_respond', id: ch.id, accept: true }) }
      ]
    });
    S.chToasts.set(ch.id, t);
    renderFriends(); renderHeader();
  });
  Net.on('challenge_out', m => { S.chOut.set(m.ch.id, m.ch); toast('Đã gửi lời thách đấu tới ' + m.ch.to, 'success'); renderFriends(); });
  Net.on('challenge_gone', m => {
    S.chIn.delete(m.id);
    S.chOut.delete(m.id);
    const t = S.chToasts.get(m.id);
    if (t) { t.close(); S.chToasts.delete(m.id); }
    if (m.msg) toast(m.msg, 'info');
    renderFriends(); renderHeader();
  });
  Net.on('queue', m => {
    S.queue = m.on ? { variant: m.variant, since: S.queue && S.queue.variant === m.variant ? S.queue.since : Date.now() } : null;
    if (m.matched) { toast('Đã tìm thấy đối thủ!', 'success'); Sound.notify(); }
    renderQueuePill();
  });
  Net.on('rooms', m => { S.rooms = m.list; if (m.stats) S.stats = m.stats; renderRooms(); renderHeroStats(); });
  Net.on('room', m => onRoom(m.room));
  Net.on('room_left', m => {
    S.room = null;
    S.chat = [];
    if (Game.mode === 'online') { Game.mode = null; if (S.view === 'game') go('rooms'); }
    $('#nav-game').hidden = !Game.mode;
    if (m.msg) toast(m.msg, 'warn');
  });
  Net.on('chat_history', m => { S.chat = m.list || []; Game.renderChat(); });
  Net.on('chat', m => {
    S.chat.push(m.msg);
    if (S.chat.length > 120) S.chat.shift();
    Game.appendChat(m.msg);
    const chatOpen = S.view === 'game' && $('#side-tabs .active').dataset.tab === 'chat';
    if (!chatOpen && m.msg.role !== 'sys') { S.unread++; Game.renderChatBadge(); }
  });
  Net.on('game_over', m => Game.showOnlineResult(m));
  Net.on('leaderboard', m => { S.leaderboard = m.list; if (S.view === 'rank') renderRank(); });
  Net.on('profile', m => { S.profile = m.profile; if (S.view === 'profile') renderProfile(); });
  Net.on('search', m => { S.search = m.list; renderSearch(); });
  Net.on('game_record', m => Game.startReplay(m.game));
  Net.on('invite', m => {
    Sound.notify();
    toast(m.from + ' mời bạn vào phòng "' + m.room.name + '" (' + VAR[m.room.variant] + ')', 'challenge', {
      timeout: 20000,
      actions: [{ label: 'Bỏ qua', kind: 'ghost' }, { label: 'Vào phòng', kind: 'primary', onClick: () => joinRoom(m.room.id, 'spectator') }]
    });
  });

  // ═════════════════════ Điều hướng ═════════════════════
  const VIEWS = ['home', 'rooms', 'friends', 'rank', 'profile', 'game'];
  function show(view, sub) {
    S.view = view;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
    Net.send({ t: 'room_watch', on: view === 'rooms' });
    if (view === 'home') renderHome();
    if (view === 'rooms') renderRooms();
    if (view === 'friends') renderFriends();
    if (view === 'rank') {
      if (sub && ['board', 'tiers', 'titles'].includes(sub)) S.rankTab = sub;
      Net.send({ t: 'leaderboard' });
      renderRank();
    }
    if (view === 'game') Game.render();
    if (view !== 'game') window.scrollTo(0, 0);
  }
  function route() {
    const raw = location.hash.replace(/^#/, '') || 'home';
    const i = raw.indexOf('/');
    const v = i < 0 ? raw : raw.slice(0, i), sub = i < 0 ? '' : decodeURIComponent(raw.slice(i + 1));
    if (v === 'profile') {
      S.profileName = sub || (S.me && S.me.name) || '';
      if (!S.profileName) return go('home');
      if (!S.profile || S.profile.name.toLowerCase() !== S.profileName.toLowerCase()) S.profile = null;
      show('profile');
      renderProfile();
      Net.send({ t: 'profile', name: S.profileName });
      return;
    }
    if (v === 'game' && !Game.mode) return go(S.room ? 'rooms' : 'home');
    show(VIEWS.includes(v) ? v : 'home', sub);
  }
  function go(hash) {
    if (location.hash === '#' + hash) route();
    else location.hash = hash;
  }
  const openProfile = name => go('profile/' + encodeURIComponent(name));

  // ═════════════════════ Thanh trên ═════════════════════
  function renderHeader() {
    const ua = $('#user-area');
    ua.textContent = '';
    if (S.me) {
      ua.append(h('div', { class: 'user-chip', title: 'Hồ sơ của bạn', onclick: () => openProfile(S.me.name) },
        avatar(S.me.name), h('span', { class: 'uc-name' }, S.me.name), rankBadge(S.me.points)));
    } else {
      ua.append(h('button', { class: 'btn primary sm', onclick: () => openAuth('login') }, 'Đăng nhập'));
    }
    ua.append(h('button', { class: 'btn ghost icon-btn', title: 'Cài đặt', 'aria-label': 'Cài đặt', onclick: openSettings }, '⚙'));
    const n = (S.friends.incoming || []).length + S.chIn.size;
    const b = $('#badge-friends');
    b.hidden = !n;
    b.textContent = n;
  }

  function renderQueuePill() {
    const el = $('#queue-pill');
    if (!S.queue) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = '';
    const sec = Math.floor((Date.now() - S.queue.since) / 1000);
    el.append(h('span', { class: 'spinner' }), h('span', { class: 'q-text' }, 'Tìm đối thủ · ' + VAR[S.queue.variant] + ' · '),
      h('b', null, Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')),
      h('button', { class: 'btn xs ghost', title: 'Hủy tìm trận', onclick: () => send({ t: 'queue_leave' }) }, '✕'));
  }
  setInterval(() => { if (S.queue) renderQueuePill(); }, 1000);

  function openSettings() {
    const han = h('input', { type: 'checkbox', checked: settings.han });
    const snd = h('input', { type: 'checkbox', checked: settings.sound });
    modal({
      title: 'Cài đặt',
      body: h('div', null,
        h('label', { class: 'check-row' }, han, 'Hiển thị quân cờ bằng chữ Hán (帥 俥 傌…) – bỏ chọn để dùng chữ Việt'),
        h('label', { class: 'check-row' }, snd, 'Bật âm thanh'),
        h('p', { class: 'muted', style: 'font-size:13px;margin:12px 0 0' }, 'Mẹo: có thể kéo-thả hoặc bấm chọn quân rồi bấm ô đích để đi.')),
      actions: [{
        label: 'Lưu', kind: 'primary', onClick: () => {
          settings.han = han.checked;
          settings.sound = snd.checked;
          saveSettings();
          Game.board.setHan(settings.han);
          Game.render();
        }
      }]
    });
  }

  // ═════════════════════ Đăng nhập / đăng ký ═════════════════════
  function openAuth(mode) {
    if (!Net.available()) {
      toast('Tính năng trực tuyến cần server: chạy "node server.js" rồi mở http://localhost:3000', 'warn', { timeout: 7000 });
      return;
    }
    if (S.authDlg) return;
    let m = mode || 'login';
    const name = h('input', { class: 'input', maxlength: 20, autocomplete: 'username', placeholder: 'VD: kythu_ha_noi' });
    const pass = h('input', { class: 'input', type: 'password', maxlength: 100, autocomplete: 'current-password' });
    const pass2 = h('input', { class: 'input', type: 'password', maxlength: 100, autocomplete: 'new-password' });
    const err = h('div', { class: 'form-err' });
    const f2 = field('Nhập lại mật khẩu', pass2);
    const sw = h('div', { class: 'auth-switch' });
    const submit = () => {
      err.textContent = '';
      const n = name.value.trim(), p = pass.value;
      if (n.length < 3) { err.textContent = 'Tên cần ít nhất 3 ký tự'; return; }
      if (p.length < 4) { err.textContent = 'Mật khẩu cần ít nhất 4 ký tự'; return; }
      if (m === 'register' && p !== pass2.value) { err.textContent = 'Hai mật khẩu không khớp'; return; }
      S.explicitAuth = true;
      if (!Net.send({ t: m, name: n, password: p })) err.textContent = 'Chưa kết nối được máy chủ';
    };
    const form = h('form', { onsubmit: e => { e.preventDefault(); submit(); } },
      field('Tên người chơi', name), field('Mật khẩu', pass), f2, err,
      h('button', { type: 'submit', hidden: true }), sw);
    const dlg = modal({
      title: '', body: form,
      actions: [{ label: 'Hủy', kind: 'ghost' }, { label: '…', kind: 'primary', onClick: () => { submit(); return false; } }],
      onClose: () => { S.authDlg = null; }
    });
    const okBtn = $$('.modal-foot .btn', dlg.box).pop();
    const update = () => {
      dlg.title.textContent = m === 'login' ? 'Đăng nhập' : 'Tạo tài khoản';
      okBtn.textContent = m === 'login' ? 'Đăng nhập' : 'Đăng ký';
      f2.hidden = m === 'login';
      pass.autocomplete = m === 'login' ? 'current-password' : 'new-password';
      sw.textContent = '';
      sw.append(m === 'login' ? 'Chưa có tài khoản? ' : 'Đã có tài khoản? ',
        h('a', { onclick: () => { m = m === 'login' ? 'register' : 'login'; err.textContent = ''; update(); } }, m === 'login' ? 'Đăng ký ngay' : 'Đăng nhập'));
    };
    update();
    S.authDlg = { close: dlg.close, err };
  }

  function logout() {
    if (Game.mode === 'online' && S.room && S.room.game && S.room.game.status === 'playing' && (S.room.you === 'r' || S.room.you === 'b')) {
      return toast('Bạn đang trong một ván cờ, hãy kết thúc ván trước', 'warn');
    }
    if (S.room) send({ t: 'room_leave' });
    send({ t: 'logout' });
    S.token = null;
    LS.del('token');
    S.me = null;
    S.friends = { friends: [], incoming: [], outgoing: [] };
    S.chIn.clear(); S.chOut.clear();
    renderHeader();
    go('home');
  }

  // ═════════════════════ Trang chủ ═════════════════════
  function renderHeroStats() {
    const el = $('#hero-stats');
    if (!el) return;
    el.textContent = '';
    if (!S.stats) {
      el.append(h('span', { class: 'stat-pill' }, Net.available() ? 'Đang kết nối máy chủ…' : 'Chế độ ngoại tuyến – vẫn chơi được với máy'));
      return;
    }
    const st = S.stats;
    el.append(
      h('span', { class: 'stat-pill' }, h('b', null, st.online), 'đang trực tuyến'),
      h('span', { class: 'stat-pill' }, h('b', null, st.playing), 'ván đang diễn ra'),
      h('span', { class: 'stat-pill' }, h('b', null, st.rooms), 'phòng'),
      h('span', { class: 'stat-pill' }, h('b', null, (st.queue.thuong || 0) + (st.queue.up || 0)), 'người đang tìm trận'));
  }

  function kv(v, label) { return h('div', { class: 'kv' }, h('b', null, v), h('span', null, label)); }

  function rankCard(u) {
    const t = RK.rankOf(u.points);
    const best = RK.bestTitle(u.titles);
    return [
      h('div', { class: 'rank-card-head' }, avatar(u.name),
        h('div', null, h('div', { class: 'rank-card-name' }, u.name),
          h('div', { class: 'row-sub' }, best ? titleChip(best.name) : h('span', { class: 'dim' }, 'Chưa có danh hiệu'))),
        h('div', { class: 'rank-emblem', style: '--rc:' + t.color }, h('div', null, t.rankName, h('br'), h('span', { class: 'stars' }, starStr(t.star))))),
      h('div', { class: 'rank-card-meta' }, h('span', null, t.name),
        h('span', null, t.next != null ? u.points + ' / ' + t.next + ' điểm' : u.points + ' điểm · cấp cao nhất')),
      h('div', { class: 'progress', style: '--rc:' + t.color }, h('i', { style: 'width:' + Math.round(t.progress * 100) + '%' })),
      h('div', { class: 'kv-grid' }, kv(u.points, 'Điểm'), kv(u.wins, 'Thắng'), kv(u.losses, 'Thua'), kv(u.streak || 0, 'Chuỗi thắng'))
    ];
  }

  function renderHome() {
    renderHeroStats();
    const card = $('#hero-card');
    card.textContent = '';
    if (S.me) {
      card.append(...rankCard(S.me));
      card.append(h('div', { class: 'mode-actions', style: 'margin-top:16px' },
        h('button', { class: 'btn primary', onclick: () => joinQueue('thuong') }, 'Đấu ngẫu nhiên ngay'),
        h('button', { class: 'btn', onclick: () => openProfile(S.me.name) }, 'Hồ sơ & lịch sử')));
    } else {
      card.append(
        h('h3', { style: 'font-family:var(--display);font-size:22px' }, 'Thi đấu trực tuyến'),
        h('p', { class: 'muted', style: 'margin:8px 0 14px' }, 'Tạo tài khoản miễn phí để kết bạn, vào phòng, đấu xếp hạng và nhận danh hiệu. Chơi với máy không cần tài khoản.'),
        h('div', { class: 'mode-actions' },
          h('button', { class: 'btn primary', onclick: () => openAuth('register') }, 'Tạo tài khoản'),
          h('button', { class: 'btn', onclick: () => openAuth('login') }, 'Đăng nhập')),
        h('div', { class: 'kv-grid', style: 'margin-top:18px' }, kv('5', 'Hạng'), kv('25', 'Cấp sao'), kv(RK.TITLES.length, 'Danh hiệu'), kv('4', 'Cấp máy')));
    }
  }

  // ═════════════════════ Phòng chơi ═════════════════════
  function renderRoomsSub() {
    const el = $('#rooms-sub');
    if (!el || !S.stats) return;
    el.textContent = S.stats.rooms + ' phòng · ' + S.stats.playing + ' ván đang diễn ra · ' + S.stats.online + ' người trực tuyến';
  }

  function roomMatches(r) {
    if (S.roomFilter === 'wait' && r.playing) return false;
    if (S.roomFilter === 'play' && !r.playing) return false;
    if (S.roomVariant !== 'all' && r.variant !== S.roomVariant) return false;
    const q = S.roomQuery.trim().toLowerCase();
    if (q) {
      const hay = [r.name, r.owner, r.red && r.red.name, r.black && r.black.name, r.referee].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function vsSide(p, col, right) {
    const piece = h('span', { class: 'mini-piece ' + (col === 'r' ? 'red' : 'black') }, X.HAN[col].K);
    if (!p) return h('div', { class: 'vs-side' + (right ? ' right' : '') }, piece, h('span', { class: 'seat-empty' }, 'Ghế trống'));
    return h('div', { class: 'vs-side' + (right ? ' right' : '') }, piece,
      h('div', { style: 'min-width:0;display:grid;gap:2px' + (right ? ';justify-items:end' : '') }, h('span', { class: 'nm' }, p.name), rankBadgeTier(p.tier)));
  }

  function roomCard(r) {
    const chips = [
      h('span', { class: 'chip' + (r.variant === 'up' ? ' up' : '') }, VAR[r.variant]),
      h('span', { class: 'chip' }, '⏱ ' + fmtTimeCtl(r.time, r.inc)),
      r.rated ? h('span', { class: 'chip rated' }, 'Tính điểm') : h('span', { class: 'chip' }, 'Giao hữu'),
      r.kind === 'match' ? h('span', { class: 'chip' }, 'Ghép ngẫu nhiên') : null,
      r.kind === 'challenge' ? h('span', { class: 'chip' }, 'Thách đấu') : null,
      r.hasPassword ? h('span', { class: 'chip', title: 'Có mật khẩu' }, '🔒') : null,
      r.playing ? h('span', { class: 'chip live' }, 'Đang chơi · nước ' + Math.ceil(r.plies / 2)) : h('span', { class: 'chip ok' }, 'Đang chờ')
    ];
    const acts = h('div', { class: 'row-actions' });
    const inThis = S.room && S.room.id === r.id;
    if (inThis) acts.append(h('button', { class: 'btn sm primary', onclick: () => go('game') }, 'Về bàn'));
    else {
      acts.append(h('button', { class: 'btn sm', onclick: () => joinRoom(r.id, 'spectator') }, '👁 Xem'));
      if (!r.playing && (!r.red || !r.black)) acts.append(h('button', { class: 'btn sm primary', onclick: () => joinRoom(r.id, !r.red ? 'r' : 'b') }, 'Vào chơi'));
      if (!r.referee) acts.append(h('button', { class: 'btn sm', onclick: () => joinRoom(r.id, 'referee') }, '⚖ Trọng tài'));
    }
    return h('div', { class: 'room-card' },
      h('div', { class: 'room-card-head' },
        h('div', { style: 'min-width:0' }, h('div', { class: 'room-name' }, r.name), h('div', { class: 'room-chips' }, chips)),
        h('span', { class: 'dim', style: 'font-size:12px' }, '#' + r.id)),
      h('div', { class: 'versus' }, vsSide(r.red, 'r'), h('span', { class: 'vs-mid' }, 'VS'), vsSide(r.black, 'b', true)),
      h('div', { class: 'room-foot' },
        h('span', null, '👁 ' + r.spectators + ' người xem · ⚖ ' + (r.referee || 'chưa có trọng tài')),
        acts));
  }

  function renderRooms() {
    renderRoomsSub();
    const list = $('#room-list');
    if (!list) return;
    list.textContent = '';
    if (!Net.ready) {
      list.append(h('div', { class: 'empty', style: 'grid-column:1/-1' }, Net.available() ? 'Đang kết nối máy chủ…' : 'Danh sách phòng cần server. Chạy "node server.js" rồi mở http://localhost:3000'));
      return;
    }
    const items = S.rooms.filter(roomMatches);
    if (!items.length) {
      list.append(h('div', { class: 'empty', style: 'grid-column:1/-1' },
        S.rooms.length ? 'Không có phòng phù hợp bộ lọc.' : 'Chưa có phòng nào – hãy là người đầu tiên tạo phòng!',
        h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn primary sm', onclick: openCreateRoom }, '+ Tạo phòng'))));
      return;
    }
    for (const r of items) list.append(roomCard(r));
  }

  function joinRoom(id, as, password) {
    if (needLogin()) return;
    if (S.room && S.room.id !== id && S.room.game && S.room.game.status === 'playing' && (S.room.you === 'r' || S.room.you === 'b')) {
      return toast('Bạn đang chơi ở phòng khác', 'warn');
    }
    S.pendingJoin = { id, as };
    send({ t: 'room_join', id, as, password });
  }

  function askRoomPassword(roomId, msg) {
    const pj = S.pendingJoin && S.pendingJoin.id === roomId ? S.pendingJoin : { id: roomId, as: 'spectator' };
    const inp = h('input', { class: 'input', type: 'password', maxlength: 20, placeholder: 'Mật khẩu phòng' });
    const dlg = modal({
      title: 'Phòng có mật khẩu',
      body: h('form', { onsubmit: e => { e.preventDefault(); dlg.close(); send({ t: 'room_join', id: pj.id, as: pj.as, password: inp.value }); } },
        h('p', { class: 'muted', style: 'margin-top:0' }, msg), inp),
      actions: [{ label: 'Hủy', kind: 'ghost' }, { label: 'Vào phòng', kind: 'primary', onClick: () => send({ t: 'room_join', id: pj.id, as: pj.as, password: inp.value }) }]
    });
  }

  function roomForm(init, withSeat) {
    init = init || {};
    const name = h('input', { class: 'input', maxlength: 40, value: init.name || '', placeholder: S.me ? 'Phòng của ' + S.me.name : 'Tên phòng' });
    const variant = segControl([['thuong', 'Cờ tướng'], ['up', 'Cờ úp']], init.variant || 'thuong');
    const time = selectBox(TIME_OPTS.map(t => [t, t ? t + ' phút' : 'Không giới hạn']), init.time != null ? init.time : 10);
    const inc = selectBox(INC_OPTS.map(t => [t, t ? '+' + t + ' giây / nước' : 'Không cộng']), init.inc != null ? init.inc : 0);
    const rated = h('input', { type: 'checkbox', checked: !!init.rated });
    const priv = h('input', { type: 'checkbox', checked: !!init.private });
    const pass = h('input', { class: 'input', maxlength: 20, value: init.password || '', placeholder: 'Để trống nếu không cần' });
    const seat = withSeat ? segControl([['r', 'Ghế Đỏ'], ['b', 'Ghế Đen'], ['referee', 'Trọng tài'], ['spectator', 'Quan sát']], 'r') : null;
    const el = h('div', null,
      field('Tên phòng', name),
      field('Loại cờ', variant),
      h('div', { class: 'field-row' }, field('Thời gian mỗi bên', time), field('Cộng giờ', inc)),
      field('Mật khẩu', pass),
      h('label', { class: 'check-row' }, rated, 'Ván tính điểm xếp hạng (không cho đi lại)'),
      h('label', { class: 'check-row' }, priv, 'Phòng riêng – ẩn khỏi danh sách (chỉ vào được qua lời mời)'),
      seat ? field('Vị trí của bạn', seat, 'mt') : null);
    return {
      el,
      values: () => ({
        name: name.value.trim(), variant: variant.getValue(), time: Number(time.value), inc: Number(inc.value),
        rated: rated.checked, private: priv.checked, password: pass.value.trim(), seat: seat ? seat.getValue() : undefined
      })
    };
  }

  function openCreateRoom() {
    if (needLogin()) return;
    if (S.room && S.room.game && S.room.game.status === 'playing' && (S.room.you === 'r' || S.room.you === 'b')) return toast('Bạn đang trong một ván cờ', 'warn');
    const f = roomForm(LS.get('lastRoom', { time: 10, inc: 0 }), true);
    modal({
      title: 'Tạo phòng mới', body: f.el,
      actions: [{ label: 'Hủy', kind: 'ghost' }, {
        label: 'Tạo phòng', kind: 'primary', onClick: () => {
          const v = f.values();
          LS.set('lastRoom', { variant: v.variant, time: v.time, inc: v.inc, rated: v.rated });
          send(Object.assign({ t: 'room_create' }, v));
        }
      }]
    });
  }

  function openRoomSettings() {
    const r = S.room;
    if (!r) return;
    const f = roomForm({ name: r.name, variant: r.variant, time: r.time, inc: r.inc, rated: r.rated, private: r.private, password: r.password || '' }, false);
    modal({
      title: 'Cài đặt phòng', body: f.el,
      actions: [{ label: 'Hủy', kind: 'ghost' }, { label: 'Lưu', kind: 'primary', onClick: () => send(Object.assign({ t: 'room_settings' }, f.values())) }]
    });
  }

  function joinQueue(variant) {
    if (needLogin()) return;
    if (S.room && S.room.game && S.room.game.status === 'playing' && (S.room.you === 'r' || S.room.you === 'b')) return toast('Bạn đang trong một ván cờ', 'warn');
    if (S.queue) return toast('Bạn đang tìm trận rồi', 'info');
    if (send({ t: 'queue_join', variant })) toast('Đang tìm đối thủ ' + VAR[variant] + '…', 'info');
  }

  // ═════════════════════ Bạn bè ═════════════════════
  function friendActions(f) {
    const acts = [];
    if (f.status !== 'offline' && f.status !== 'playing') acts.push(h('button', { class: 'btn sm primary', onclick: () => openChallenge(f.name) }, '⚔ Thách đấu'));
    if (f.roomId && !(S.room && S.room.id === f.roomId)) acts.push(h('button', { class: 'btn sm', onclick: () => joinRoom(f.roomId, 'spectator') }, '👁 Xem'));
    if (S.room && f.status !== 'offline' && f.roomId !== S.room.id) acts.push(h('button', { class: 'btn sm', onclick: () => send({ t: 'room_invite', name: f.name }) }, 'Mời vào phòng'));
    acts.push(h('button', {
      class: 'btn sm ghost', title: 'Hủy kết bạn', onclick: async () => {
        if (await confirmBox('Hủy kết bạn', 'Xóa ' + f.name + ' khỏi danh sách bạn bè?', 'Xóa', 'danger')) send({ t: 'friend_remove', name: f.name });
      }
    }, '✕'));
    return acts;
  }

  function personRow(p, sub, acts) {
    return h('div', { class: 'row-item' },
      avatar(p.name),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, userLink(p.name), rankBadgeTier(p.tier), titleChip(p.title)),
        h('div', { class: 'row-sub' }, sub)),
      h('div', { class: 'row-actions' }, acts));
  }

  function renderFriends() {
    const fl = $('#friend-list');
    if (!fl) return;
    const inc = $('#friend-incoming'), out = $('#friend-outgoing'), chl = $('#challenge-list');
    [fl, inc, out, chl].forEach(e => { e.textContent = ''; });
    if (!S.me) {
      fl.append(h('div', { class: 'empty' }, 'Đăng nhập để kết bạn và thách đấu.',
        h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn primary sm', onclick: () => openAuth('login') }, 'Đăng nhập'))));
      $('#friend-count').textContent = '';
      renderSearch();
      return;
    }
    const F = S.friends;
    const onlineN = F.friends.filter(f => f.status !== 'offline').length;
    $('#friend-count').textContent = onlineN + ' / ' + F.friends.length + ' trực tuyến';
    if (!F.friends.length) fl.append(h('div', { class: 'empty' }, 'Chưa có bạn bè. Tìm tên người chơi ở ô bên cạnh để kết bạn.'));
    for (const f of F.friends) {
      fl.append(personRow(f, [h('span', { class: dotClass(f.status) }), h('span', { class: 'status-text ' + f.status }, STATUS_TEXT[f.status]), h('span', null, '· ' + f.points + ' điểm')], friendActions(f)));
    }
    if (!F.incoming.length) inc.append(h('div', { class: 'empty' }, 'Không có lời mời mới'));
    for (const p of F.incoming) {
      inc.append(personRow(p, 'Muốn kết bạn với bạn', [
        h('button', { class: 'btn sm primary', onclick: () => send({ t: 'friend_respond', name: p.name, accept: true }) }, 'Đồng ý'),
        h('button', { class: 'btn sm ghost', onclick: () => send({ t: 'friend_respond', name: p.name, accept: false }) }, 'Từ chối')]));
    }
    if (!F.outgoing.length) out.append(h('div', { class: 'dim', style: 'font-size:13px' }, 'Không có'));
    for (const p of F.outgoing) {
      out.append(personRow(p, 'Đang chờ đồng ý', [h('button', { class: 'btn sm ghost', onclick: () => send({ t: 'friend_remove', name: p.name }) }, 'Thu hồi')]));
    }
    const chs = [...S.chIn.values()].map(c => ({ c, dir: 'in' })).concat([...S.chOut.values()].map(c => ({ c, dir: 'out' })));
    if (!chs.length) chl.append(h('div', { class: 'empty' }, 'Không có lời thách đấu'));
    for (const { c, dir } of chs) {
      const info = VAR[c.variant] + ' · ' + fmtTimeCtl(c.time, c.inc) + ' · ' + (c.rated ? 'tính điểm' : 'giao hữu');
      chl.append(h('div', { class: 'row-item' },
        h('span', { class: 'mini-piece red' }, '戰'),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, dir === 'in' ? [userLink(c.from), ' thách đấu bạn'] : ['Bạn thách đấu ', userLink(c.to)]),
          h('div', { class: 'row-sub' }, info)),
        h('div', { class: 'row-actions' }, dir === 'in'
          ? [h('button', { class: 'btn sm primary', onclick: () => send({ t: 'challenge_respond', id: c.id, accept: true }) }, 'Nhận lời'),
            h('button', { class: 'btn sm ghost', onclick: () => send({ t: 'challenge_respond', id: c.id, accept: false }) }, 'Từ chối')]
          : [h('button', { class: 'btn sm ghost', onclick: () => send({ t: 'challenge_cancel', id: c.id }) }, 'Hủy')])));
    }
    renderSearch();
  }

  function renderSearch() {
    const el = $('#search-results');
    if (!el) return;
    el.textContent = '';
    const q = $('#friend-search').value.trim();
    if (!q) return;
    if (!S.me) { el.append(h('div', { class: 'empty' }, 'Đăng nhập để tìm và kết bạn')); return; }
    if (!S.search.length) { el.append(h('div', { class: 'empty' }, 'Không tìm thấy người chơi "' + q + '"')); return; }
    for (const p of S.search) {
      let act;
      if (p.relation === 'friend') act = h('span', { class: 'chip ok' }, '✓ Bạn bè');
      else if (p.relation === 'outgoing') act = h('span', { class: 'chip' }, 'Đã gửi lời mời');
      else if (p.relation === 'incoming') act = h('button', { class: 'btn sm primary', onclick: () => send({ t: 'friend_respond', name: p.name, accept: true }) }, 'Đồng ý kết bạn');
      else act = h('button', { class: 'btn sm primary', onclick: () => send({ t: 'friend_request', name: p.name }) }, '+ Kết bạn');
      el.append(personRow(p, [h('span', { class: 'online-dot' + (p.online ? ' on' : '') }), p.online ? 'Trực tuyến' : 'Ngoại tuyến', ' · ' + p.points + ' điểm'], [act]));
    }
  }

  function openChallenge(name) {
    if (needLogin()) return;
    const last = LS.get('lastChallenge', { variant: 'thuong', time: 10, inc: 5, rated: false });
    const variant = segControl([['thuong', 'Cờ tướng'], ['up', 'Cờ úp']], last.variant);
    const time = selectBox(TIME_OPTS.map(t => [t, t ? t + ' phút' : 'Không giới hạn']), last.time);
    const inc = selectBox(INC_OPTS.map(t => [t, t ? '+' + t + ' giây / nước' : 'Không cộng']), last.inc);
    const rated = h('input', { type: 'checkbox', checked: last.rated });
    modal({
      title: 'Thách đấu ' + name,
      body: h('div', null, field('Loại cờ', variant),
        h('div', { class: 'field-row' }, field('Thời gian mỗi bên', time), field('Cộng giờ', inc)),
        h('label', { class: 'check-row' }, rated, 'Tính điểm xếp hạng'),
        h('p', { class: 'muted', style: 'font-size:13px;margin:10px 0 0' }, 'Màu quân được chọn ngẫu nhiên. Lời thách đấu hết hạn sau 60 giây.')),
      actions: [{ label: 'Hủy', kind: 'ghost' }, {
        label: 'Gửi lời thách đấu', kind: 'primary', onClick: () => {
          const v = { variant: variant.getValue(), time: Number(time.value), inc: Number(inc.value), rated: rated.checked };
          LS.set('lastChallenge', v);
          send(Object.assign({ t: 'challenge', name }, v));
        }
      }]
    });
  }

  // ═════════════════════ Xếp hạng ═════════════════════
  function renderRank() {
    $$('#rank-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === S.rankTab));
    const c = $('#rank-content');
    c.textContent = '';
    if (S.rankTab === 'board') {
      if (!S.leaderboard) {
        c.append(h('div', { class: 'empty' }, Net.ready ? 'Đang tải bảng xếp hạng…' : 'Bảng xếp hạng cần kết nối máy chủ.'));
        return;
      }
      if (!S.leaderboard.length) { c.append(h('div', { class: 'empty' }, 'Chưa có kỳ thủ nào.')); return; }
      const tb = h('tbody');
      for (const u of S.leaderboard) {
        const total = u.wins + u.losses + u.draws;
        tb.append(h('tr', { class: S.me && S.me.name === u.name ? 'me' : '' },
          h('td', null, h('span', { class: 'medal' + (u.no <= 3 ? ' m' + u.no : '') }, u.no)),
          h('td', null, h('div', { class: 'who' }, avatar(u.name), h('div', { class: 'who-text' }, h('div', null, userLink(u.name), ' ', h('span', { class: 'online-dot' + (u.online ? ' on' : '') })), titleChip(u.title)))),
          h('td', null, rankBadgeTier(u.tier)),
          h('td', { class: 'num' }, h('b', null, u.points)),
          h('td', { class: 'num hide-sm' }, u.wins + ' / ' + u.draws + ' / ' + u.losses),
          h('td', { class: 'num hide-sm' }, total ? Math.round(u.wins / total * 100) + '%' : '–'),
          h('td', { class: 'num hide-sm' }, u.bestStreak)));
      }
      c.append(h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Kỳ thủ'), h('th', null, 'Cấp bậc'), h('th', null, 'Điểm'),
          h('th', { class: 'hide-sm' }, 'T / H / B'), h('th', { class: 'hide-sm' }, 'Tỉ lệ thắng'), h('th', { class: 'hide-sm' }, 'Chuỗi tốt nhất'))), tb)));
    } else if (S.rankTab === 'tiers') {
      const myTier = S.me ? RK.tierIndex(S.me.points) : -1;
      const grid = h('div', { class: 'tiers' });
      RK.RANKS.forEach((rk, ri) => {
        const col = h('div', { class: 'tier-col', style: '--rc:' + rk.color }, h('div', { class: 'tier-col-head' }, rk.name));
        RK.TIERS.filter(t => t.rank === ri).forEach(t => {
          col.append(h('div', { class: 'tier-row' + (t.index === myTier ? ' current' : '') },
            h('span', null, t.starName, ' ', h('span', { class: 'stars' }, starStr(t.star))),
            h('span', { class: 'dim' }, t.min + '+')));
        });
        grid.append(col);
      });
      c.append(grid, h('div', { class: 'note-box' }, h('h3', null, 'Cách tính điểm'),
        h('ul', null,
          h('li', null, 'Thắng: +20 đến +40 điểm tùy chênh lệch trình độ, cộng thêm thưởng chuỗi thắng (tối đa +10).'),
          h('li', null, 'Thua: −10 đến −30 điểm. Hạng Tập sự chỉ bị trừ một nửa.'),
          h('li', null, 'Hòa: được hoặc mất vài điểm tùy chênh lệch. Hòa và thua đều làm đứt chuỗi thắng.'),
          h('li', null, 'Chỉ ván tính điểm mới thay đổi điểm, cấp bậc, chuỗi thắng và danh hiệu.'))));
    } else {
      const grid = h('div', { class: 'titles-grid' });
      const have = new Set(S.me ? S.me.titles : []);
      for (const t of RK.TITLES) {
        const got = have.has(t.id);
        let prog = null;
        if (S.me && !got) {
          const cur = t.kind === 'streak' ? S.me.bestStreak : S.me.wins;
          prog = h('div', null, h('div', { class: 'progress' }, h('i', { style: 'width:' + Math.min(100, Math.round(cur / t.need * 100)) + '%' })),
            h('div', { class: 'dim', style: 'font-size:11.5px;margin-top:3px' }, Math.min(cur, t.need) + ' / ' + t.need + (t.kind === 'streak' ? ' (chuỗi tốt nhất)' : ' ván thắng')));
        }
        const short = t.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3);
        grid.append(h('div', { class: 'title-card' + (got ? ' got' : '') },
          h('div', { class: 'seal' }, got ? '✓' : short),
          h('div', { style: 'min-width:0;flex:1' }, h('div', { class: 't-name' }, t.name), h('div', { class: 't-desc' }, t.desc), prog)));
      }
      c.append(grid, h('div', { class: 'note-box' }, 'Danh hiệu nhận được giữ vĩnh viễn; danh hiệu cao nhất hiển thị cạnh tên của bạn. Chuỗi thắng tính trên các ván tính điểm liên tiếp.'));
    }
  }

  // ═════════════════════ Hồ sơ ═════════════════════
  function renderProfile() {
    const c = $('#profile-content');
    c.textContent = '';
    const p = S.profile;
    if (!p) {
      c.append(h('div', { class: 'empty' }, Net.ready ? 'Đang tải hồ sơ…' : 'Hồ sơ cần kết nối máy chủ.'));
      return;
    }
    const isMe = S.me && S.me.name === p.name;
    const t = RK.rankOf(p.points);
    const acts = h('div', { class: 'mode-actions', style: 'margin-left:auto' });
    if (isMe) acts.append(h('button', { class: 'btn ghost', onclick: logout }, 'Đăng xuất'));
    else if (S.me) {
      if (p.relation === 'friend') {
        if (p.status !== 'offline' && p.status !== 'playing') acts.append(h('button', { class: 'btn primary', onclick: () => openChallenge(p.name) }, '⚔ Thách đấu'));
        acts.append(h('button', { class: 'btn ghost', onclick: () => send({ t: 'friend_remove', name: p.name }) }, 'Hủy kết bạn'));
      } else if (p.relation === 'incoming') acts.append(h('button', { class: 'btn primary', onclick: () => send({ t: 'friend_respond', name: p.name, accept: true }) }, 'Đồng ý kết bạn'));
      else if (p.relation === 'outgoing') acts.append(h('span', { class: 'chip' }, 'Đã gửi lời mời kết bạn'));
      else acts.append(h('button', { class: 'btn primary', onclick: () => send({ t: 'friend_request', name: p.name }) }, '+ Kết bạn'));
      if (p.roomId && !(S.room && S.room.id === p.roomId)) acts.append(h('button', { class: 'btn', onclick: () => joinRoom(p.roomId, 'spectator') }, '👁 Xem phòng'));
    }
    const best = RK.bestTitle(p.titles);
    const head = h('div', { class: 'panel' },
      h('div', { class: 'profile-head' }, avatar(p.name),
        h('div', { style: 'display:grid;gap:6px' },
          h('div', { class: 'profile-name' }, p.name),
          h('div', { class: 'row-title' }, rankBadge(p.points), best ? titleChip(best.name) : null,
            h('span', { class: 'row-sub' }, h('span', { class: dotClass(p.status) }), STATUS_TEXT[p.status] || ''))),
        acts),
      h('div', { class: 'rank-card-meta' }, h('span', null, t.name), h('span', null, t.next != null ? p.points + ' / ' + t.next + ' điểm → ' + t.nextName : p.points + ' điểm · cấp cao nhất')),
      h('div', { class: 'progress', style: '--rc:' + t.color }, h('i', { style: 'width:' + Math.round(t.progress * 100) + '%' })));
    const total = p.wins + p.losses + p.draws;
    const stats = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', null, 'Thống kê ván tính điểm')),
      h('div', { class: 'stat-grid' },
        kv(p.points, 'Điểm'), kv(total, 'Số ván'), kv(total ? Math.round(p.wins / total * 100) + '%' : '–', 'Tỉ lệ thắng'), kv(p.casual || 0, 'Ván giao hữu'),
        kv(p.wins, 'Thắng'), kv(p.draws, 'Hòa'), kv(p.losses, 'Thua'), kv((p.streak || 0) + ' / ' + p.bestStreak, 'Chuỗi hiện tại / tốt nhất')),
      h('div', { class: 'panel-head sub' }, h('h4', null, 'Danh hiệu (' + p.titles.length + '/' + RK.TITLES.length + ')'), h('a', { href: '#rank/titles', style: 'font-size:13px' }, 'Bảng danh hiệu →')),
      h('div', { class: 'title-list' }, p.titles.length ? p.titles.map(id => RK.TITLE_BY_ID[id]).filter(Boolean).sort((a, b) => b.order - a.order).map(x => titleChip(x.name)) : h('span', { class: 'dim' }, 'Chưa có danh hiệu nào')));
    const tb = h('tbody');
    for (const g of p.recent) {
      const res = g.outcome === 'win' ? h('span', { class: 'result-w' }, 'Thắng') : g.outcome === 'loss' ? h('span', { class: 'result-l' }, 'Thua') : h('span', { class: 'result-d' }, 'Hòa');
      tb.append(h('tr', null,
        h('td', { class: 'hide-sm dim' }, fmtDate(g.date)),
        h('td', null, h('span', { class: 'chip' + (g.variant === 'up' ? ' up' : '') }, VAR[g.variant])),
        h('td', null, h('span', { class: 'mini-piece sm ' + (g.color === 'r' ? 'red' : 'black') }, X.HAN[g.color].K), ' ', userLink(g.opponent)),
        h('td', null, res, h('div', { class: 'dim', style: 'font-size:11.5px' }, X.REASONS[g.reason] || '')),
        h('td', { class: 'num' }, g.delta == null ? h('span', { class: 'dim' }, 'giao hữu') : h('span', { class: g.delta >= 0 ? 'delta-up' : 'delta-down' }, (g.delta >= 0 ? '+' : '') + g.delta)),
        h('td', null, h('button', { class: 'btn xs', onclick: () => send({ t: 'game_get', id: g.id }) }, '▶ Xem lại'))));
    }
    const hist = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', null, 'Ván gần đây')),
      p.recent.length ? h('div', { class: 'table-wrap', style: 'border:0' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', { class: 'hide-sm' }, 'Thời gian'), h('th', null, 'Loại'), h('th', null, 'Đối thủ'), h('th', null, 'Kết quả'), h('th', null, 'Điểm'), h('th', null, ''))), tb))
        : h('div', { class: 'empty' }, 'Chưa có ván nào'));
    c.append(head, h('div', { class: 'profile-grid' }, stats, hist));
  }

  // ═════════════════════ Máy chơi (AI) ═════════════════════
  const AI = {
    worker: null, seq: 0, pending: new Map(), fallbackLoading: null,
    init() {
      try {
        this.worker = new Worker('js/ai.js');
        this.worker.onmessage = e => {
          const cb = this.pending.get(e.data.id);
          if (cb) { this.pending.delete(e.data.id); cb(e.data); }
        };
        this.worker.onerror = () => {
          this.worker = null;
          const jobs = [...this.pending.values()];
          this.pending.clear();
          jobs.forEach(cb => cb(null));
        };
      } catch (e) { this.worker = null; }
    },
    loadFallback() {
      if (window.XqAI) return Promise.resolve();
      if (!this.fallbackLoading) {
        this.fallbackLoading = new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'js/ai.js';
          s.onload = res;
          s.onerror = rej;
          document.head.appendChild(s);
        });
      }
      return this.fallbackLoading;
    },
    think(data) {
      const t0 = Date.now();
      return new Promise(resolve => {
        const done = res => setTimeout(() => resolve(res), Math.max(0, 420 - (Date.now() - t0)));
        const local = () => this.loadFallback().then(() => setTimeout(() => done(window.XqAI.think(data)), 20));
        if (this.worker) {
          const id = ++this.seq;
          this.pending.set(id, res => (res ? done(res) : local()));
          this.worker.postMessage(Object.assign({ id }, data));
        } else local();
      });
    }
  };

  function poolAvg(moves) {
    const pool = X.hiddenPool(moves), out = {};
    for (const c of ['r', 'b']) {
      let s = 0, n = 0;
      for (const t of Object.keys(pool[c])) { s += pool[c][t] * PIECE_VAL[t]; n += pool[c][t]; }
      out[c] = n ? s / n : 300;
    }
    return out;
  }

  function aiPayload(g, level, time) {
    return {
      board: g.board, turn: g.turn, variant: g.variant, level, time,
      avg: poolAvg(g.moves), plies: g.moves.length,
      history: g.snapshots.slice(-60).map(s => ({ board: s.board, turn: s.turn }))
    };
  }

  // ═════════════════════ Bộ điều khiển ván cờ ═════════════════════
  function capturedSorted(list) { return list.slice().sort((a, b) => PIECE_VAL[b] - PIECE_VAL[a]); }

  function renderMoveList(moves, opts) {
    opts = opts || {};
    const ol = $('#move-list');
    ol.textContent = '';
    ol.classList.toggle('clickable', !!opts.onPick);
    if (!moves.length) { ol.append(h('li', { class: 'moves-empty', style: 'display:block' }, 'Chưa có nước đi')); return; }
    for (let i = 0; i < moves.length; i += 2) {
      const li = h('li', null, h('span', { class: 'no' }, (i / 2 + 1) + '.'));
      for (const j of [i, i + 1]) {
        const m = moves[j];
        if (!m) { li.append(h('span')); continue; }
        const cur = opts.current != null ? opts.current === j + 1 : j === moves.length - 1;
        li.append(h('span', { class: 'mv ' + m.color + (cur ? ' cur' : ''), onclick: opts.onPick ? () => opts.onPick(j + 1) : null },
          m.n, m.check ? h('span', { class: 'chk' }, '+') : null, m.rev ? h('span', { class: 'rev' }, '(' + X.NAMES[m.rev] + ')') : null));
      }
      ol.append(li);
    }
    const curEl = $('.mv.cur', ol);
    if (curEl && opts.current != null) curEl.scrollIntoView({ block: 'nearest' });
    else ol.scrollTop = ol.scrollHeight;
  }

  function renderPool(variant, moves) {
    const el = $('#pool-box');
    el.textContent = '';
    if (variant !== 'up') return;
    const pool = X.hiddenPool(moves);
    const box = h('div', { class: 'pool' }, h('div', null, 'Quân còn úp (chưa lật):'));
    for (const c of ['r', 'b']) {
      const row = h('div', { class: 'pool-row' }, h('b', null, colorName(c) + ':'));
      let any = false;
      for (const t of ['R', 'C', 'H', 'E', 'A', 'P']) {
        if (pool[c][t] > 0) { any = true; row.append(h('span', { class: 'pool-item' }, miniPiece(c, t, true), '×' + pool[c][t])); }
      }
      if (!any) row.append(h('span', { class: 'dim' }, 'đã lật hết'));
      box.append(row);
    }
    el.append(box);
  }

  const Game = {
    mode: null, board: null, flipManual: false,
    L: null, RP: null, lastGameId: null, lastPlies: -1, optimistic: null, resultDlg: null,

    init() {
      this.board = new window.BoardView($('#board'));
      this.board.setHan(settings.han);
      this.board.onSelect = () => Sound.select();
      $$('#side-tabs button').forEach(b => b.addEventListener('click', () => this.setTab(b.dataset.tab)));
      $('#chat-form').addEventListener('submit', e => {
        e.preventDefault();
        const inp = $('#chat-input'), text = inp.value.trim();
        if (!text) return;
        if (send({ t: 'chat', text })) inp.value = '';
      });
      setInterval(() => this.tickClocks(), 200);
    },

    setTab(tab) {
      $$('#side-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
      if (tab === 'chat') {
        S.unread = 0;
        this.renderChatBadge();
        const log = $('#chat-log');
        log.scrollTop = log.scrollHeight;
      }
    },

    render(animate) {
      if (this.mode === 'online') this.renderOnline();
      else if (this.mode === 'local') this.renderLocal(animate);
      else if (this.mode === 'replay') this.renderReplay();
      const online = this.mode === 'online';
      $('#side-tabs [data-tab=chat]').hidden = !online;
      $('#side-tabs [data-tab=people]').hidden = !online;
      if (!online && $('#side-tabs .active').dataset.tab !== 'moves') this.setTab('moves');
      $('#nav-game').hidden = !this.mode;
    },

    setStatus(text, cls) {
      const el = $('#game-status');
      el.className = 'game-status' + (cls ? ' ' + cls : '');
      el.textContent = text;
    },

    renderBar(el, info) {
      el.textContent = '';
      el.className = 'player-bar' + (info.turn ? ' turn' : '');
      el.append(h('span', { class: 'pb-side ' + info.color, title: colorName(info.color) }));
      if (info.isBot) el.append(h('span', { class: 'avatar bot' }, '機'));
      else if (info.name) el.append(avatar(info.name));
      else el.append(h('span', { class: 'avatar', style: '--h:30;opacity:.25' }, '?'));
      const nm = info.name
        ? (info.linked ? h('span', { class: 'nm ulink', onclick: () => openProfile(info.name) }, info.name) : h('span', { class: 'nm' }, info.name))
        : h('span', { class: 'nm dim' }, 'Ghế trống');
      el.append(h('div', { class: 'pb-info' },
        h('div', { class: 'pb-name' }, nm, info.tier != null ? rankBadgeTier(info.tier) : null),
        h('div', { class: 'pb-sub' }, info.sub || [])));
      if (info.captured && info.captured.length) {
        el.append(h('div', { class: 'pb-captured', title: 'Quân đã ăn được' }, capturedSorted(info.captured).map(t => miniPiece(X.other(info.color), t, true))));
      }
      if (info.clock !== undefined) {
        const ck = h('div', { class: 'pb-clock', 'data-side': info.color }, fmtClock(info.clock));
        if (info.clock != null && info.clock < 20000 && info.turn) ck.classList.add('low');
        el.append(ck);
      }
    },

    renderControls(btns) {
      const el = $('#controls');
      el.textContent = '';
      el.append(...btns.filter(Boolean));
    },

    btn(label, cls, fn, opts) {
      opts = opts || {};
      return h('button', { class: 'btn sm ' + (cls || ''), onclick: fn, disabled: !!opts.disabled, title: opts.title || null }, label);
    },

    renderPrompt(text, actions) {
      const el = $('#prompt-bar');
      if (!text) { el.hidden = true; el.textContent = ''; return; }
      el.hidden = false;
      el.textContent = '';
      el.append(h('span', null, text), h('div', { class: 'acts' }, actions || []));
    },

    checkSquare(board, turn, inCheck) { return inCheck ? X.findKing(board, turn) : -1; },

    // ───────────── Trực tuyến ─────────────
    enterOnline() {
      if (this.mode === 'local' && this.L) this.L.token++;
      this.mode = 'online';
      this.flipManual = false;
      this.lastGameId = null;
      this.lastPlies = -1;
      this.optimistic = null;
      this.board.setHint(null);
      this.board.clearSelection();
      go('game');
      this.render();
      this.renderChat();
    },

    renderOnline() {
      const r = S.room;
      if (!r) return;
      const g = r.game, you = r.you;
      const playing = !!(g && g.status === 'playing');
      const isPlayer = you === 'r' || you === 'b';
      this.board.setFlipped((you === 'b') !== this.flipManual);

      const board = g ? g.board : X.startBoard(r.variant);
      const lm = g && g.moves.length ? g.moves[g.moves.length - 1] : null;
      const plies = g ? g.moves.length : -1;
      const gid = g ? g.id : null;
      const newMove = g && gid === this.lastGameId && plies === this.lastPlies + 1 && lm;
      const opt = this.optimistic;
      const mine = newMove && opt && opt.from === lm.from && opt.to === lm.to;
      this.optimistic = null;
      if (g && gid !== this.lastGameId && g.status === 'playing' && g.moves.length === 0) Sound.start();
      this.board.setPosition(board, { lastMove: lm, animate: !!newMove && !mine, check: g && g.check ? X.findKing(board, g.turn) : -1 });
      if (newMove) {
        if (lm.check) Sound.check();
        else if (!mine) (lm.cap ? Sound.capture : Sound.move)();
      }
      this.lastGameId = gid;
      this.lastPlies = plies;

      const myTurn = playing && !g.paused && you === g.turn;
      this.board.setInteractive(
        myTurn ? s => !!board[s] && board[s][0] === you : null,
        s => X.legalMovesFrom(board, s, r.variant),
        (f, t) => this.sendMove(board, f, t));

      // thanh người chơi
      const bottom = this.board.flipped ? 'b' : 'r', top = X.other(bottom);
      const elapsed = Date.now() - S.roomRecvAt;
      for (const [el, c] of [[$('#pb-top'), top], [$('#pb-bottom'), bottom]]) {
        const p = playing ? g.players[c] : r.seats[c];
        let clock;
        if (r.time > 0) clock = playing ? g.clocks[c] - (g.running && g.turn === c ? elapsed : 0) : r.time * 60000;
        else clock = null;
        const sub = [];
        if (playing) {
          if (g.turn === c) sub.push(h('span', { class: 'thinking' }, g.paused ? '⏸ Tạm dừng' : (you === c ? '● Lượt của bạn' : '● Đang suy nghĩ…')));
          if (g.drawOffer === c) sub.push(h('span', { class: 'chip' }, 'Cầu hòa'));
        } else if (p) {
          sub.push(r.ready[c] ? h('span', { class: 'ready-tag' }, '✔ Sẵn sàng') : h('span', { class: 'dim' }, 'Chưa sẵn sàng'));
        } else {
          sub.push(h('button', { class: 'btn xs' + (isPlayer ? ' ghost' : ''), onclick: () => send({ t: 'room_sit', seat: c }) }, isPlayer ? 'Đổi sang ghế này' : 'Ngồi vào'));
        }
        if (p && p.title) sub.push(titleChip(p.title));
        if (p && !p.online) sub.push(h('span', { class: 'chip live' }, 'Mất kết nối'));
        this.renderBar(el, {
          color: c, name: p ? p.name : null, linked: true, tier: p ? p.tier : null,
          turn: playing && g.turn === c, clock, sub,
          captured: g ? g.captured[X.other(c)] : []
        });
      }

      // trạng thái
      if (playing) {
        if (g.paused) this.setStatus('⏸ Trọng tài đang tạm dừng ván', 'alert');
        else {
          const who = you === g.turn ? 'Đến lượt bạn' : 'Lượt quân ' + colorName(g.turn);
          this.setStatus((g.check ? '⚠ Chiếu tướng! ' : '') + who, g.check ? 'alert' : '');
        }
      } else {
        let t;
        if (!r.seats.r || !r.seats.b) t = 'Đang chờ đủ hai kỳ thủ…';
        else if (r.ready.r && r.ready.b && r.referee) t = 'Hai bên đã sẵn sàng – chờ trọng tài bắt đầu ván';
        else t = isPlayer && !r.ready[you] ? 'Bấm "Sẵn sàng" để bắt đầu' + (r.lastResult ? ' ván mới (hai bên sẽ đổi màu)' : '') : 'Chờ hai bên sẵn sàng…';
        if (r.lastResult) {
          const lr = r.lastResult;
          t = 'Ván trước: ' + (lr.result === 'draw' ? 'Hòa' : colorName(lr.result) + ' thắng') + ' – ' + (X.REASONS[lr.reason] || '') + '. ' + t;
        }
        this.setStatus(t, r.lastResult ? 'done' : '');
      }

      // lời đề nghị
      if (playing && isPlayer && g.drawOffer && g.drawOffer !== you) {
        this.renderPrompt('🤝 Đối thủ xin hòa', [
          this.btn('Đồng ý hòa', 'primary', () => send({ t: 'draw_respond', accept: true })),
          this.btn('Từ chối', 'ghost', () => send({ t: 'draw_respond', accept: false }))]);
      } else if (playing && isPlayer && g.undoReq && g.undoReq !== you) {
        this.renderPrompt('↶ Đối thủ xin đi lại', [
          this.btn('Cho đi lại', 'primary', () => send({ t: 'undo_respond', accept: true })),
          this.btn('Không', 'ghost', () => send({ t: 'undo_respond', accept: false }))]);
      } else if (playing && isPlayer && (g.drawOffer === you || g.undoReq === you)) {
        this.renderPrompt(g.drawOffer === you ? 'Đã gửi lời cầu hòa – chờ đối thủ trả lời…' : 'Đã xin đi lại – chờ đối thủ trả lời…');
      } else this.renderPrompt(null);

      // nút điều khiển
      const B = [];
      if (isPlayer) {
        if (playing) {
          B.push(this.btn('🤝 Cầu hòa', '', () => send({ t: 'draw_offer' }), { disabled: !!g.drawOffer || g.moves.length < 2 }));
          if (r.allowUndo) B.push(this.btn('↶ Xin đi lại', '', () => send({ t: 'undo_request' }), { disabled: !!g.undoReq || !g.moves.some(m => m.color === you) }));
          B.push(this.btn('🏳 Đầu hàng', 'danger', async () => {
            if (await confirmBox('Đầu hàng', 'Bạn chắc chắn muốn đầu hàng ván này?', 'Đầu hàng', 'danger')) send({ t: 'resign' });
          }));
        } else {
          const rd = r.ready[you];
          B.push(this.btn(rd ? 'Hủy sẵn sàng' : '✔ Sẵn sàng', rd ? '' : 'primary', () => send({ t: 'room_ready', ready: !rd })));
          B.push(this.btn('Đứng dậy xem', 'ghost', () => send({ t: 'room_sit', seat: 'spectator' })));
        }
      } else if (you === 'referee') {
        if (playing) {
          B.push(this.btn(g.paused ? '▶ Tiếp tục ván' : '⏸ Tạm dừng', g.paused ? 'primary' : '', () => send({ t: 'ref_pause', pause: !g.paused })));
          B.push(this.btn('⚖ Phân xử', 'primary', () => this.openRefDecide()));
          B.push(this.btn('⚠ Nhắc nhở', '', () => this.openRefWarn()));
          if (r.time > 0) B.push(this.btn('⏱ Cộng giờ', '', () => this.openRefTime()));
        } else {
          B.push(this.btn('▶ Bắt đầu ván', 'primary', () => send({ t: 'ref_start' }), { disabled: !(r.seats.r && r.seats.b && r.ready.r && r.ready.b), title: 'Cần hai kỳ thủ đã sẵn sàng' }));
          B.push(this.btn('Rời ghế trọng tài', 'ghost', () => send({ t: 'room_sit', seat: 'spectator' })));
        }
      } else {
        if (!playing) {
          if (!r.seats.r) B.push(this.btn('Ngồi ghế Đỏ', 'primary', () => send({ t: 'room_sit', seat: 'r' })));
          if (!r.seats.b) B.push(this.btn('Ngồi ghế Đen', 'primary', () => send({ t: 'room_sit', seat: 'b' })));
        }
        if (!r.referee) B.push(this.btn('⚖ Làm trọng tài', '', () => send({ t: 'room_sit', seat: 'referee' })));
      }
      B.push(this.btn('⇅ Lật bàn', 'ghost', () => { this.flipManual = !this.flipManual; this.render(); }));
      if (r.isOwner && !playing) B.push(this.btn('⚙ Cài đặt phòng', 'ghost', openRoomSettings));
      B.push(this.btn('Rời phòng', 'ghost', () => this.leaveOnline()));
      this.renderControls(B);

      // thông tin phòng
      const info = $('#room-info');
      info.textContent = '';
      info.append(
        h('div', { class: 'room-info-title' }, h('b', null, r.name), h('span', { class: 'dim', style: 'font-size:12px' }, 'Phòng #' + r.id)),
        h('div', { class: 'room-chips' },
          h('span', { class: 'chip' + (r.variant === 'up' ? ' up' : '') }, VAR[r.variant]),
          h('span', { class: 'chip' }, '⏱ ' + fmtTimeCtl(r.time, r.inc)),
          r.rated ? h('span', { class: 'chip rated' }, 'Tính điểm') : h('span', { class: 'chip' }, 'Giao hữu'),
          r.hasPassword ? h('span', { class: 'chip' }, '🔒 Mật khẩu') : null,
          r.private ? h('span', { class: 'chip' }, 'Phòng riêng') : null),
        h('div', { class: 'row-sub' }, 'Chủ phòng: ', userLink(r.owner), ' · Bạn đang là ', h('b', null,
          { r: 'kỳ thủ Đỏ', b: 'kỳ thủ Đen', referee: 'trọng tài', spectator: 'người quan sát' }[you] || '')));

      renderMoveList(g ? g.moves : []);
      renderPool(r.variant, g ? g.moves : []);
      this.renderPeople();
    },

    sendMove(board, f, t) {
      const b = board.slice();
      const cap = !!b[t];
      b[t] = b[f];
      b[f] = null;
      this.optimistic = { from: f, to: t };
      this.board.setInteractive(null);
      this.board.setPosition(b, { lastMove: { from: f, to: t }, animate: true });
      (cap ? Sound.capture : Sound.move)();
      if (!send({ t: 'move', from: f, to: t })) { this.optimistic = null; this.render(); }
    },

    async leaveOnline() {
      const r = S.room;
      if (!r) return;
      const g = r.game;
      if (g && g.status === 'playing' && (r.you === 'r' || r.you === 'b')) {
        if (!(await confirmBox('Rời phòng', 'Ván đang diễn ra – rời phòng sẽ bị xử THUA. Bạn chắc chắn?', 'Rời phòng', 'danger'))) return;
      }
      send({ t: 'room_leave' });
    },

    renderPeople() {
      const el = $('#people');
      const r = S.room;
      if (!el || !r) return;
      el.textContent = '';
      const canKick = r.isOwner || r.you === 'referee';
      const playing = r.game && r.game.status === 'playing';
      const meName = S.me ? S.me.name : '';
      const kickBtn = p => (canKick && p.name !== meName && p.key !== r.ownerKey)
        ? h('button', { class: 'btn xs ghost', title: 'Mời ra khỏi phòng', onclick: async () => {
          if (await confirmBox('Mời ra khỏi phòng', 'Mời ' + p.name + ' ra khỏi phòng? Người này sẽ không vào lại được.', 'Mời ra', 'danger')) send({ t: 'room_kick', name: p.name });
        } }, '✕') : null;
      const row = (p, sub, acts) => h('div', { class: 'row-item' }, avatar(p.name),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, userLink(p.name), rankBadgeTier(p.tier)), h('div', { class: 'row-sub' }, sub)),
        h('div', { class: 'row-actions' }, acts));
      let n = 0;
      const players = h('div', { class: 'people-sec' }, h('h4', null, 'Kỳ thủ'));
      for (const c of ['r', 'b']) {
        const p = r.seats[c];
        if (p) { n++; players.append(row(p, [h('span', { class: 'pb-side ' + c }), colorName(c), r.ready[c] && !playing ? ' · ✔ sẵn sàng' : '', p.online ? '' : ' · mất kết nối'], playing ? null : kickBtn(p))); }
        else players.append(h('div', { class: 'row-item' }, h('span', { class: 'pb-side ' + c }), h('div', { class: 'row-main dim' }, 'Ghế ' + colorName(c) + ' trống')));
      }
      const ref = h('div', { class: 'people-sec' }, h('h4', null, 'Trọng tài'));
      if (r.referee) { n++; ref.append(row(r.referee, '⚖ Trọng tài', kickBtn(r.referee))); }
      else ref.append(h('div', { class: 'row-item' }, h('div', { class: 'row-main dim' }, 'Chưa có trọng tài'),
        r.you !== 'r' && r.you !== 'b' || !playing ? h('button', { class: 'btn xs', onclick: () => send({ t: 'room_sit', seat: 'referee' }) }, 'Nhận làm') : null));
      n += r.spectators.length;
      const specs = h('div', { class: 'people-sec' }, h('h4', null, h('span', null, 'Người quan sát'), h('span', { class: 'count' }, r.spectators.length)));
      if (!r.spectators.length) specs.append(h('div', { class: 'dim', style: 'font-size:13px' }, 'Chưa có ai'));
      for (const p of r.spectators) specs.append(row(p, p.online ? '👁 Đang xem' : 'Mất kết nối', kickBtn(p)));
      el.append(players, ref, specs);
      if (S.me) {
        const inRoom = new Set([r.seats.r, r.seats.b, r.referee].concat(r.spectators).filter(Boolean).map(p => p.name));
        const cands = S.friends.friends.filter(f => f.status !== 'offline' && !inRoom.has(f.name));
        const inv = h('div', { class: 'people-sec' }, h('h4', null, 'Mời bạn bè vào phòng'));
        if (!cands.length) inv.append(h('div', { class: 'dim', style: 'font-size:13px' }, 'Không có bạn bè trực tuyến nào khác'));
        for (const f of cands) inv.append(row(f, STATUS_TEXT[f.status], h('button', { class: 'btn xs', onclick: () => send({ t: 'room_invite', name: f.name }) }, 'Mời')));
        el.append(inv);
      }
      $('#people-count').textContent = n;
    },

    renderChat() {
      const log = $('#chat-log');
      log.textContent = '';
      for (const m of S.chat) log.append(this.chatEl(m));
      log.scrollTop = log.scrollHeight;
    },
    chatEl(m) {
      if (m.role === 'sys') return h('div', { class: 'msg sys' }, m.text);
      const tag = { r: 'Đỏ', b: 'Đen', referee: 'Trọng tài', spectator: 'Xem' }[m.role] || '';
      return h('div', { class: 'msg' }, h('span', { class: 'who-tag ' + m.role }, tag), h('span', { class: 'from' }, m.from + ':'), m.text);
    },
    appendChat(m) {
      const log = $('#chat-log');
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      log.append(this.chatEl(m));
      while (log.children.length > 150) log.firstChild.remove();
      if (atBottom) log.scrollTop = log.scrollHeight;
    },
    renderChatBadge() {
      const b = $('#badge-chat');
      b.hidden = !S.unread;
      b.textContent = S.unread > 9 ? '9+' : S.unread;
    },

    tickClocks() {
      if (this.mode !== 'online' || !S.room || !S.room.game || S.view !== 'game') return;
      const g = S.room.game;
      if (!g.running) return;
      const left = g.clocks[g.turn] - (Date.now() - S.roomRecvAt);
      const el = $('.pb-clock[data-side=' + g.turn + ']');
      if (!el) return;
      el.textContent = fmtClock(left);
      el.classList.toggle('low', left < 20000);
    },

    openRefDecide() {
      const r = S.room;
      if (!r || !r.game) return;
      const res = segControl([['r', 'Đỏ thắng (' + r.game.players.r.name + ')'], ['b', 'Đen thắng (' + r.game.players.b.name + ')'], ['draw', 'Xử hòa']], 'draw');
      const note = h('input', { class: 'input', maxlength: 160, placeholder: 'VD: Đen phạm luật bắt dai' });
      modal({
        title: 'Trọng tài phân xử',
        body: h('div', null, field('Kết quả', res), field('Lý do (hiển thị cho cả phòng)', note)),
        actions: [{ label: 'Hủy', kind: 'ghost' }, { label: 'Kết thúc ván', kind: 'primary', onClick: () => send({ t: 'ref_decide', result: res.getValue(), note: note.value }) }]
      });
    },
    openRefWarn() {
      const r = S.room;
      if (!r || !r.game) return;
      const seat = segControl([['r', 'Đỏ – ' + r.game.players.r.name], ['b', 'Đen – ' + r.game.players.b.name]], 'r');
      const note = h('input', { class: 'input', maxlength: 160, placeholder: 'VD: Không được chiếu dai' });
      modal({
        title: 'Nhắc nhở kỳ thủ',
        body: h('div', null, field('Kỳ thủ', seat), field('Nội dung', note)),
        actions: [{ label: 'Hủy', kind: 'ghost' }, { label: 'Gửi nhắc nhở', kind: 'primary', onClick: () => send({ t: 'ref_warn', seat: seat.getValue(), note: note.value }) }]
      });
    },
    openRefTime() {
      const r = S.room;
      if (!r || !r.game) return;
      const seat = segControl([['r', 'Đỏ – ' + r.game.players.r.name], ['b', 'Đen – ' + r.game.players.b.name]], 'r');
      const sec = segControl([[30, '+30 giây'], [60, '+1 phút'], [120, '+2 phút'], [300, '+5 phút']], 60);
      modal({
        title: 'Cộng thời gian',
        body: h('div', null, field('Kỳ thủ', seat), field('Thời gian', sec)),
        actions: [{ label: 'Hủy', kind: 'ghost' }, { label: 'Cộng giờ', kind: 'primary', onClick: () => send({ t: 'ref_time', seat: seat.getValue(), sec: sec.getValue() }) }]
      });
    },

    showOnlineResult(m) {
      if (this.resultDlg) this.resultDlg.close();
      const you = m.you, isPlayer = you === 'r' || you === 'b';
      let cls, big;
      if (m.result === 'draw') { cls = 'draw'; big = 'Hòa cờ'; }
      else if (isPlayer) { cls = m.result === you ? 'win' : 'loss'; big = m.result === you ? 'Chiến thắng!' : 'Thất bại'; }
      else { cls = 'draw'; big = colorName(m.result) + ' thắng'; }
      const body = h('div', null, h('div', { class: 'result-hero' },
        h('div', { class: 'big ' + cls }, big),
        h('div', { class: 'reason' }, (X.REASONS[m.reason] || '') + (m.note ? ' – ' + m.note : '')),
        h('div', { class: 'reason' }, m.players.r + ' (Đỏ) – ' + m.players.b + ' (Đen)')));
      if (m.changes && isPlayer && m.changes[you]) {
        const c = m.changes[you];
        const box = h('div', { class: 'result-box' },
          h('div', { class: 'delta-big ' + (c.delta >= 0 ? 'delta-up' : 'delta-down') }, (c.delta >= 0 ? '+' : '') + c.delta + ' điểm'),
          h('div', { class: 'rank-card-meta', style: 'margin:0' }, h('span', null, c.before + ' → ' + c.after + ' điểm'), h('span', null, RK.TIERS[c.tierAfter].name)),
          h('div', { class: 'progress', style: '--rc:' + RK.TIERS[c.tierAfter].color }, h('i', { style: 'width:' + Math.round(RK.rankOf(c.after).progress * 100) + '%' })));
        if (c.tierAfter > c.tierBefore) box.append(h('div', { class: 'levelup' }, '▲ Thăng cấp: ' + RK.TIERS[c.tierAfter].name));
        else if (c.tierAfter < c.tierBefore) box.append(h('div', { class: 'dim', style: 'text-align:center' }, '▼ Xuống cấp: ' + RK.TIERS[c.tierAfter].name));
        if (c.streak >= 2) box.append(h('div', { style: 'text-align:center;color:var(--gold-2);font-weight:700' }, '🔥 Chuỗi ' + c.streak + ' trận thắng liên tiếp'));
        for (const id of c.newTitles || []) {
          const t = RK.TITLE_BY_ID[id];
          if (t) box.append(h('div', { class: 'new-title' }, h('div', { class: 'muted' }, 'Danh hiệu mới!'), titleChip(t.name), h('div', { class: 'dim', style: 'font-size:12px;margin-top:4px' }, t.desc)));
        }
        body.append(box);
      } else if (!m.rated && isPlayer) {
        body.append(h('p', { class: 'muted', style: 'text-align:center;margin:12px 0 0' }, 'Ván giao hữu – không thay đổi điểm xếp hạng.'));
      }
      if (isPlayer) (cls === 'win' ? Sound.win : cls === 'loss' ? Sound.lose : Sound.notify)();
      else Sound.notify();
      const acts = [{ label: 'Đóng', kind: 'ghost' }];
      if (isPlayer) acts.push({ label: 'Ván mới (Sẵn sàng)', kind: 'primary', onClick: () => send({ t: 'room_ready', ready: true }) });
      this.resultDlg = modal({ title: 'Kết thúc ván', body, actions: acts, onClose: () => { this.resultDlg = null; } });
    },

    // ───────────── Ngoại tuyến (máy / 2 người) ─────────────
    async openLocalSetup(variant, vs) {
      const last = LS.get('lastLocal', { level: 2, color: 'r' });
      const vSeg = segControl([['thuong', 'Cờ tướng'], ['up', 'Cờ úp']], variant || 'thuong');
      const levelSeg = segControl(Object.entries(LEVELS).map(([k, v]) => [Number(k), v]), last.level);
      const colorSeg = segControl([['r', 'Quân Đỏ (đi trước)'], ['b', 'Quân Đen'], ['random', 'Ngẫu nhiên']], last.color);
      const botFields = h('div', null, field('Cấp độ máy', levelSeg), field('Bạn cầm', colorSeg));
      const vsSeg = segControl([['bot', 'Đấu với máy'], ['human', '2 người cùng máy']], vs || 'bot', v => { botFields.hidden = v !== 'bot'; });
      botFields.hidden = (vs || 'bot') !== 'bot';
      modal({
        title: 'Ván luyện tập',
        body: h('div', null, field('Loại cờ', vSeg), field('Đối thủ', vsSeg), botFields,
          h('p', { class: 'muted', style: 'font-size:13px;margin:4px 0 0' }, 'Ván luyện tập không tính điểm. Máy chơi cờ úp không biết quân úp là gì – giống hệt bạn.')),
        actions: [{ label: 'Hủy', kind: 'ghost' }, {
          label: 'Bắt đầu', kind: 'primary', onClick: () => {
            const o = { variant: vSeg.getValue(), vs: vsSeg.getValue(), level: levelSeg.getValue(), color: colorSeg.getValue() };
            LS.set('lastLocal', { level: o.level, color: o.color });
            this.startLocal(o);
          }
        }]
      });
    },

    async ensureNoRoom() {
      if (!S.room) return true;
      const g = S.room.game;
      if (g && g.status === 'playing' && (S.room.you === 'r' || S.room.you === 'b')) {
        toast('Bạn đang trong một ván trực tuyến', 'warn');
        return false;
      }
      if (!(await confirmBox('Rời phòng', 'Bạn đang ở phòng "' + S.room.name + '". Rời phòng để tiếp tục?', 'Rời phòng'))) return false;
      send({ t: 'room_leave' });
      S.room = null;
      return true;
    },

    async startLocal(o) {
      if (!(await this.ensureNoRoom())) return;
      const human = o.color === 'random' ? (Math.random() < 0.5 ? 'r' : 'b') : o.color;
      if (this.L) this.L.token++;
      this.mode = 'local';
      this.flipManual = false;
      this.L = { variant: o.variant, vs: o.vs, level: o.level, human, g: X.createGame(o.variant), thinking: false, token: 0, hint: null, opts: o, reported: false };
      this.board.setHint(null);
      this.board.clearSelection();
      this.board.setPosition(this.L.g.board, {});
      Sound.start();
      go('game');
      this.render();
      if (o.vs === 'bot' && human !== 'r') this.botMove();
    },

    localNames() {
      const L = this.L;
      if (L.vs === 'human') return { r: 'Người chơi Đỏ', b: 'Người chơi Đen' };
      const me = S.me ? S.me.name : 'Bạn', bot = 'Máy · ' + LEVELS[L.level];
      return L.human === 'r' ? { r: me, b: bot } : { r: bot, b: me };
    },

    renderLocal(animate) {
      const L = this.L, g = L.g;
      this.board.setFlipped((L.vs === 'bot' && L.human === 'b') !== this.flipManual);
      const lm = g.moves.length ? g.moves[g.moves.length - 1] : null;
      const chk = g.status === 'playing' && X.inCheck(g.board, g.turn, g.variant);
      this.board.setPosition(g.board, { lastMove: lm, animate: !!animate, check: chk ? X.findKing(g.board, g.turn) : -1 });
      const canMove = g.status === 'playing' && !L.thinking && (L.vs === 'human' || g.turn === L.human);
      this.board.setInteractive(canMove ? s => !!g.board[s] && g.board[s][0] === g.turn : null,
        s => X.legalMovesFrom(g.board, s, g.variant), (f, t) => this.localMove(f, t));

      const names = this.localNames();
      const bottom = this.board.flipped ? 'b' : 'r', top = X.other(bottom);
      for (const [el, c] of [[$('#pb-top'), top], [$('#pb-bottom'), bottom]]) {
        const isBot = L.vs === 'bot' && c !== L.human;
        const sub = [];
        if (g.status === 'playing' && g.turn === c) sub.push(h('span', { class: 'thinking' }, isBot ? [h('span', { class: 'spinner' }), 'Máy đang suy nghĩ…'] : '● Đến lượt'));
        if (!isBot && S.me && L.vs === 'bot') sub.push(rankBadge(S.me.points));
        this.renderBar(el, { color: c, name: names[c], isBot, turn: g.status === 'playing' && g.turn === c, sub, captured: g.captured[X.other(c)] });
      }

      if (g.status === 'ended') this.setStatus(this.localResultText(), 'done');
      else if (L.thinking) this.setStatus('Máy đang suy nghĩ…', chk ? 'alert' : '');
      else this.setStatus((chk ? '⚠ Chiếu tướng! ' : '') + (L.vs === 'bot' ? (g.turn === L.human ? 'Đến lượt bạn' : 'Lượt của máy') : 'Lượt quân ' + colorName(g.turn)), chk ? 'alert' : '');
      this.renderPrompt(null);

      const B = [
        this.btn('↶ Đi lại', '', () => this.localUndo(), { disabled: !g.moves.length }),
        this.btn('💡 Gợi ý', '', () => this.localHint(), { disabled: !canMove }),
        this.btn('⇅ Lật bàn', 'ghost', () => { this.flipManual = !this.flipManual; this.render(); }),
        this.btn('⟳ Ván mới', 'primary', () => this.openLocalSetup(L.variant, L.vs)),
        this.btn('Thoát', 'ghost', () => this.exitMode())
      ];
      this.renderControls(B);

      const info = $('#room-info');
      info.textContent = '';
      info.append(h('div', { class: 'room-info-title' }, h('b', null, 'Ván luyện tập'), h('span', { class: 'chip' }, 'Ngoại tuyến')),
        h('div', { class: 'room-chips' }, h('span', { class: 'chip' + (L.variant === 'up' ? ' up' : '') }, VAR[L.variant]),
          h('span', { class: 'chip' }, L.vs === 'bot' ? 'Đấu với máy · ' + LEVELS[L.level] : '2 người cùng máy'),
          h('span', { class: 'chip' }, 'Không tính điểm')));
      renderMoveList(g.moves);
      renderPool(L.variant, g.moves);
    },

    localResultText() {
      const g = this.L.g, L = this.L;
      const reason = X.REASONS[g.reason] || '';
      if (g.result === 'draw') return 'Hòa cờ – ' + reason;
      if (L.vs === 'bot') return (g.result === L.human ? 'Bạn thắng!' : 'Máy thắng') + ' – ' + reason;
      return 'Quân ' + colorName(g.result) + ' thắng – ' + reason;
    },

    localMove(f, t) {
      const L = this.L, g = L.g;
      const res = X.makeMove(g, f, t);
      if (!res.ok) { toast(res.error, 'error'); return; }
      this.board.setHint(null);
      this.afterLocalMove(res.move);
      if (g.status === 'playing' && L.vs === 'bot' && g.turn !== L.human) this.botMove();
    },

    afterLocalMove(mv) {
      if (mv.check) Sound.check();
      else (mv.cap ? Sound.capture : Sound.move)();
      this.render(true);
      if (this.L.g.status === 'ended') setTimeout(() => this.showLocalResult(), 450);
    },

    botMove() {
      const L = this.L, g = L.g;
      L.thinking = true;
      const token = ++L.token;
      this.render();
      AI.think(aiPayload(g, L.level)).then(res => {
        if (this.mode !== 'local' || this.L !== L || token !== L.token) return;
        L.thinking = false;
        if (!res || res.from < 0) { this.render(); return; }
        const r = X.makeMove(g, res.from, res.to);
        if (!r.ok) { console.warn('AI đi sai', res, r); this.render(); return; }
        this.afterLocalMove(r.move);
      });
    },

    localUndo() {
      const L = this.L, g = L.g;
      if (L.thinking) { L.token++; L.thinking = false; }
      if (!g.moves.length) return;
      if (L.vs === 'human') X.undo(g, 1);
      else {
        do { if (!X.undo(g, 1)) break; } while (g.moves.length && g.turn !== L.human);
      }
      this.board.setHint(null);
      this.board.clearSelection();
      this.render();
      if (L.vs === 'bot' && g.turn !== L.human && g.status === 'playing') this.botMove();
    },

    localHint() {
      const L = this.L, g = L.g;
      if (g.status !== 'playing' || L.thinking) return;
      const token = L.token;
      this.setStatus('Đang tìm gợi ý…');
      AI.think(aiPayload(g, 3, 1500)).then(res => {
        if (this.mode !== 'local' || this.L !== L || token !== L.token || !res || res.from < 0) return;
        this.board.setHint({ from: res.from, to: res.to });
        this.setStatus('Gợi ý: ' + X.moveNotation(g.board, res.from, res.to) + ' (ô tím)');
      });
    },

    showLocalResult() {
      const L = this.L, g = L.g;
      if (this.mode !== 'local' || g.status !== 'ended') return;
      let cls = 'draw', big = 'Hòa cờ';
      if (g.result !== 'draw') {
        if (L.vs === 'bot') { cls = g.result === L.human ? 'win' : 'loss'; big = g.result === L.human ? 'Bạn thắng!' : 'Máy thắng'; }
        else { cls = 'win'; big = 'Quân ' + colorName(g.result) + ' thắng'; }
      }
      (cls === 'win' ? Sound.win : cls === 'loss' ? Sound.lose : Sound.notify)();
      modal({
        title: 'Kết thúc ván',
        body: h('div', { class: 'result-hero' }, h('div', { class: 'big ' + cls }, big), h('div', { class: 'reason' }, X.REASONS[g.reason] || ''),
          h('div', { class: 'reason' }, Math.ceil(g.moves.length / 2) + ' nước · ' + VAR[L.variant] + (L.vs === 'bot' ? ' · Máy ' + LEVELS[L.level] : ''))),
        actions: [{ label: 'Xem lại bàn cờ', kind: 'ghost' }, { label: 'Ván mới', kind: 'primary', onClick: () => this.startLocal(L.opts) }]
      });
    },

    // ───────────── Xem lại ván ─────────────
    async startReplay(rec) {
      if (!(await this.ensureNoRoom())) return;
      if (this.L) this.L.token++;
      const moves = rec.moves.map((a, i) => ({ from: a[0], to: a[1], n: a[2], rev: a[3] || null, cap: a[4] || null, capH: !!a[5], check: !!a[6], color: i % 2 ? 'b' : 'r' }));
      const b = X.startBoard(rec.variant), boards = [b.slice()];
      for (const m of moves) { X.applyPublicMove(b, m); boards.push(b.slice()); }
      this.mode = 'replay';
      this.flipManual = false;
      this.RP = { rec, moves, boards, idx: boards.length - 1, timer: null };
      this.board.setHint(null);
      this.board.clearSelection();
      go('game');
      this.render();
    },

    replayGo(i, animate) {
      const RP = this.RP;
      RP.idx = Math.max(0, Math.min(RP.boards.length - 1, i));
      this.renderReplay(animate);
    },

    renderReplay(animate) {
      const RP = this.RP, rec = RP.rec, i = RP.idx;
      this.board.setFlipped(this.flipManual);
      const board = RP.boards[i], lm = i > 0 ? RP.moves[i - 1] : null;
      const turn = i % 2 ? 'b' : 'r';
      const chk = X.inCheck(board, turn, rec.variant);
      this.board.setPosition(board, { lastMove: lm, animate: !!animate, check: chk ? X.findKing(board, turn) : -1 });
      this.board.setInteractive(null);
      const cap = { r: [], b: [] };
      for (let k = 0; k < i; k++) if (RP.moves[k].cap) cap[X.other(RP.moves[k].color)].push(RP.moves[k].cap);
      const bottom = this.board.flipped ? 'b' : 'r', top = X.other(bottom);
      for (const [el, c] of [[$('#pb-top'), top], [$('#pb-bottom'), bottom]]) {
        this.renderBar(el, { color: c, name: c === 'r' ? rec.red : rec.black, linked: true, turn: i < RP.moves.length && turn === c, captured: cap[X.other(c)],
          sub: rec.result === c ? [h('span', { class: 'ready-tag' }, '🏆 Thắng')] : rec.result === 'draw' ? [h('span', { class: 'dim' }, 'Hòa')] : [] });
      }
      const resText = (rec.result === 'draw' ? 'Hòa' : colorName(rec.result) + ' thắng') + ' – ' + (X.REASONS[rec.reason] || '') + (rec.note ? ' (' + rec.note + ')' : '');
      this.setStatus('Xem lại · nước ' + i + '/' + RP.moves.length + ' · ' + resText, 'done');
      this.renderPrompt(null);
      const playing = !!RP.timer;
      this.renderControls([
        this.btn('⏮', '', () => this.replayGo(0), { title: 'Về đầu' }),
        this.btn('◀', '', () => this.replayGo(i - 1), { title: 'Lùi' }),
        this.btn(playing ? '⏸ Dừng' : '▶ Tự chạy', 'primary', () => this.toggleAutoplay()),
        this.btn('▶', '', () => this.replayGo(i + 1, true), { title: 'Tiến' }),
        this.btn('⏭', '', () => this.replayGo(RP.boards.length - 1), { title: 'Về cuối' }),
        this.btn('⇅ Lật bàn', 'ghost', () => { this.flipManual = !this.flipManual; this.render(); }),
        this.btn('Thoát', 'ghost', () => this.exitMode())
      ]);
      const info = $('#room-info');
      info.textContent = '';
      info.append(h('div', { class: 'room-info-title' }, h('b', null, rec.red + ' – ' + rec.black), h('span', { class: 'dim', style: 'font-size:12px' }, 'Ván #' + rec.id)),
        h('div', { class: 'room-chips' }, h('span', { class: 'chip' + (rec.variant === 'up' ? ' up' : '') }, VAR[rec.variant]),
          rec.rated ? h('span', { class: 'chip rated' }, 'Tính điểm') : h('span', { class: 'chip' }, 'Giao hữu'),
          h('span', { class: 'chip' }, fmtDate(rec.date))));
      renderMoveList(RP.moves, { current: i, onPick: k => this.replayGo(k) });
      renderPool(rec.variant, RP.moves.slice(0, i));
    },

    toggleAutoplay() {
      const RP = this.RP;
      if (RP.timer) { clearInterval(RP.timer); RP.timer = null; this.render(); return; }
      if (RP.idx >= RP.boards.length - 1) RP.idx = 0;
      RP.timer = setInterval(() => {
        if (this.mode !== 'replay' || this.RP !== RP || RP.idx >= RP.boards.length - 1) { clearInterval(RP.timer); RP.timer = null; if (this.RP === RP) this.render(); return; }
        this.replayGo(RP.idx + 1, true);
        Sound.move();
      }, 1100);
      this.render();
    },

    exitMode() {
      if (this.L) this.L.token++;
      if (this.RP && this.RP.timer) clearInterval(this.RP.timer);
      this.mode = S.room ? 'online' : null;
      this.L = null;
      this.RP = null;
      this.board.setHint(null);
      if (this.mode) this.render();
      else { $('#nav-game').hidden = true; go('home'); }
    }
  };

  function onRoom(room) {
    const first = !S.room || S.room.id !== room.id;
    S.room = room;
    S.roomRecvAt = Date.now();
    if (first || Game.mode !== 'online') {
      if (first) { S.unread = 0; Game.renderChatBadge(); }
      Game.enterOnline();
    } else if (S.view === 'game') Game.render();
    else Game.renderPeople();
    $('#nav-game').hidden = false;
  }

  // ═════════════════════ Sự kiện chung ═════════════════════
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'local') Game.openLocalSetup(el.dataset.variant, el.dataset.vs);
    else if (act === 'go') go(el.dataset.to);
    else if (act === 'queue') joinQueue(el.dataset.variant);
    else if (act === 'create-room') openCreateRoom();
  });
  $('#room-filter').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    S.roomFilter = b.dataset.f;
    $$('#room-filter button').forEach(x => x.classList.toggle('active', x === b));
    renderRooms();
  });
  $('#room-variant').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    S.roomVariant = b.dataset.v;
    $$('#room-variant button').forEach(x => x.classList.toggle('active', x === b));
    renderRooms();
  });
  $('#room-search').addEventListener('input', e => { S.roomQuery = e.target.value; renderRooms(); });
  $('#rank-tabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    S.rankTab = b.dataset.tab;
    renderRank();
  });
  const doSearch = debounce(q => { if (q && S.me) Net.send({ t: 'user_search', q }); else { S.search = []; renderSearch(); } }, 250);
  $('#friend-search').addEventListener('input', e => { S.search = []; doSearch(e.target.value.trim()); if (!e.target.value.trim()) renderSearch(); });
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', e => {
    const r = S.room;
    if ((r && r.game && r.game.status === 'playing' && (r.you === 'r' || r.you === 'b')) || (Game.mode === 'local' && Game.L && Game.L.g.moves.length && Game.L.g.status === 'playing')) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ═════════════════════ Khởi động ═════════════════════
  Game.init();
  AI.init();
  renderHeader();
  renderHome();
  Net.connect();
  route();
})();
