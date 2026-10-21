'use strict';
/*
 * Toàn bộ logic trực tuyến: tài khoản, bạn bè, thách đấu, ghép trận ngẫu nhiên,
 * phòng chơi (người chơi / người xem / trọng tài), đồng hồ, tính điểm & danh hiệu.
 * Server giữ trạng thái ván cờ gốc; client chỉ nhận thế cờ công khai (quân úp không lộ).
 */
const crypto = require('crypto');
const X = require('../public/shared/xiangqi.js');
const R = require('../public/shared/ranks.js');

const NAME_RE = /^[\p{L}\p{M}\p{N}_.]+( [\p{L}\p{M}\p{N}_.]+)*$/u; // cho phép tên có dấu và khoảng trắng
const TIME_OPTIONS = [0, 1, 3, 5, 10, 15, 20, 30, 45, 60]; // phút mỗi bên, 0 = không giới hạn
const INC_OPTIONS = [0, 2, 3, 5, 10, 15, 20, 30];          // giây cộng thêm mỗi nước
const ABANDON_MS = 60000;     // mất kết nối khi đang chơi quá 60 giây → xử thua
const IDLE_LEAVE_MS = 30000;  // mất kết nối khi không chơi → tự rời phòng
const CHALLENGE_MS = 60000;
const MATCH_TIME = 10, MATCH_INC = 5;
const MAX_ROOMS = 500;

const pick = (v, list, def) => (list.includes(Number(v)) ? Number(v) : def);
const clean = (s, max) => String(s == null ? '' : s).normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const colorName = c => (c === 'r' ? 'Đỏ' : 'Đen');

class Hub {
  constructor(store) {
    this.store = store;
    this.db = store.data;
    for (const k of Object.keys(this.db.users)) this.normalizeUser(this.db.users[k]);
    this.conns = new Set();
    this.online = new Map();     // key -> Set<conn>
    this.rooms = new Map();      // id -> room
    this.userRoom = new Map();   // key -> roomId
    this.queue = new Map();      // key -> { key, variant, since }
    this.challenges = new Map(); // id -> challenge
    this.timers = new Map();     // key -> timeout
    this.limits = new Map();     // giới hạn tần suất theo IP
    this.roomSeq = 1;
    this.roomsDirty = true;
    this.lastRoomsPush = 0;
    this.lastStatsPush = 0;
    setInterval(() => this.tick(), 250);
    setInterval(() => this.matchmake(), 1000);
    setInterval(() => this.heartbeat(), 25000);
    setInterval(() => this.pruneLimits(), 600000);
  }

  normalizeUser(u) {
    const def = { points: 0, wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, titles: [], friends: [], inReq: [], outReq: [], recent: [], casual: 0 };
    for (const k of Object.keys(def)) if (u[k] == null) u[k] = Array.isArray(def[k]) ? [] : def[k];
    return u;
  }

  // ───────────────────────── Kết nối ─────────────────────────
  attach(conn, ip) {
    conn.ip = ip || '?';
    conn.user = null;
    conn.watchRooms = false;
    conn.rate = { t: Date.now(), n: 0 };
    this.conns.add(conn);
    conn.on('message', raw => this.onMessage(conn, raw));
    conn.on('close', () => { this.conns.delete(conn); this.unbind(conn); });
    this.send(conn, { t: 'stats', stats: this.stats() });
  }

  heartbeat() {
    for (const c of this.conns) {
      if (!c.alive) { c.close(1001); continue; }
      c.alive = false;
      c.ping();
    }
  }

  onMessage(conn, raw) {
    const now = Date.now();
    if (now - conn.rate.t > 1000) { conn.rate.t = now; conn.rate.n = 0; }
    if (++conn.rate.n > 40) return;
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    const fn = this['h_' + msg.t];
    if (typeof fn !== 'function') return;
    if (!PUBLIC.has(msg.t) && !conn.user) return this.err(conn, 'Bạn cần đăng nhập để dùng tính năng trực tuyến', 'login');
    const fail = e => { console.error('Lỗi xử lý', msg.t, e); this.err(conn, 'Lỗi máy chủ'); };
    try {
      const r = fn.call(this, conn, msg);
      if (r && typeof r.catch === 'function') r.catch(fail);
    } catch (e) { fail(e); }
  }

  /** Giới hạn tần suất: còn được làm thêm không (tối đa max lần trong ms mili-giây). */
  allow(bucket, key, max, ms) {
    const m = this.limits.get(bucket);
    const arr = m && m.get(key);
    if (!arr) return true;
    const now = Date.now();
    return arr.filter(t => now - t < ms).length < max;
  }
  record(bucket, key) {
    let m = this.limits.get(bucket);
    if (!m) this.limits.set(bucket, (m = new Map()));
    const arr = m.get(key) || [];
    arr.push(Date.now());
    m.set(key, arr);
  }
  pruneLimits() {
    const now = Date.now();
    for (const m of this.limits.values()) {
      for (const [k, arr] of m) {
        const keep = arr.filter(t => now - t < 3600000);
        if (keep.length) m.set(k, keep); else m.delete(k);
      }
    }
  }

  send(conn, obj) { conn.send(JSON.stringify(obj)); }
  sendUser(key, obj) {
    const set = this.online.get(key);
    if (!set) return;
    const s = JSON.stringify(obj);
    for (const c of set) c.send(s);
  }
  err(conn, msg, code) { this.send(conn, { t: 'error', msg, code: code || null }); }
  toast(key, msg, kind) { this.sendUser(key, { t: 'toast', msg, kind: kind || 'info' }); }

  // ───────────────────────── Người dùng ─────────────────────────
  user(key) { return this.db.users[key] || null; }
  keyOf(name) { return String(name || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase(); }
  nameOf(key) { const u = this.user(key); return u ? u.name : '?'; }

  brief(key) {
    const u = this.user(key);
    if (!u) return null;
    const t = R.bestTitle(u.titles);
    return { key, name: u.name, points: u.points, tier: R.tierIndex(u.points), title: t ? t.name : null, streak: u.streak, online: this.online.has(key) };
  }

  meFull(key) {
    const u = this.user(key);
    return Object.assign(this.brief(key), {
      wins: u.wins, losses: u.losses, draws: u.draws, casual: u.casual, bestStreak: u.bestStreak,
      titles: u.titles.slice(), created: u.created
    });
  }

  isPlaying(key) {
    const room = this.roomOfUser(key);
    if (!room || !room.game || room.game.status !== 'playing') return false;
    return room.game.players.r === key || room.game.players.b === key;
  }

  status(key) {
    if (!this.online.has(key)) return 'offline';
    if (this.isPlaying(key)) return 'playing';
    if (this.userRoom.has(key)) return 'room';
    if (this.queue.has(key)) return 'queue';
    return 'online';
  }

  stats() {
    let playing = 0;
    for (const r of this.rooms.values()) if (r.game && r.game.status === 'playing') playing++;
    const q = { thuong: 0, up: 0 };
    for (const e of this.queue.values()) q[e.variant]++;
    return { online: this.online.size, rooms: this.rooms.size, playing, queue: q, users: Object.keys(this.db.users).length };
  }

  /** Băm mật khẩu bất đồng bộ (không chặn server khi nhiều người đăng nhập). */
  hashPassword(password, salt) {
    return new Promise((resolve, reject) => {
      crypto.scrypt(String(password), salt, 32, (e, k) => (e ? reject(e) : resolve(k.toString('hex'))));
    });
  }

  newToken(key) {
    const token = crypto.randomBytes(24).toString('hex');
    this.db.sessions[token] = { key, at: Date.now() };
    this.store.save();
    return token;
  }

  h_hello(conn, m) {
    const s = m.token && this.db.sessions[m.token];
    const key = s && (typeof s === 'string' ? s : s.key);
    if (key && this.user(key)) this.bind(conn, key, m.token);
    else this.send(conn, { t: 'guest' });
  }

  async h_register(conn, m) {
    const name = clean(m.name, 20);
    const password = String(m.password || '');
    if (name.length < 3 || !NAME_RE.test(name)) return this.send(conn, { t: 'auth_err', msg: 'Tên 3–20 ký tự, gồm chữ (có dấu), số, khoảng trắng, dấu _ hoặc .' });
    if (password.length < 4 || password.length > 100) return this.send(conn, { t: 'auth_err', msg: 'Mật khẩu cần ít nhất 4 ký tự' });
    const key = this.keyOf(name);
    if (this.db.users[key]) return this.send(conn, { t: 'auth_err', msg: 'Tên này đã có người dùng' });
    if (!this.allow('register', conn.ip, 20, 3600000)) return this.send(conn, { t: 'auth_err', msg: 'Bạn đã tạo quá nhiều tài khoản, hãy thử lại sau' });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await this.hashPassword(password, salt);
    if (this.db.users[key]) return this.send(conn, { t: 'auth_err', msg: 'Tên này đã có người dùng' });
    this.db.users[key] = this.normalizeUser({ name, salt, hash, created: Date.now() });
    this.record('register', conn.ip);
    this.store.save();
    if (!conn.closed) this.bind(conn, key, this.newToken(key));
  }

  async h_login(conn, m) {
    if (!this.allow('loginFail', conn.ip, 10, 600000)) return this.send(conn, { t: 'auth_err', msg: 'Đăng nhập sai quá nhiều lần, hãy thử lại sau 10 phút' });
    const key = this.keyOf(m.name);
    const u = this.user(key);
    // vẫn băm khi không có tài khoản để thời gian phản hồi như nhau
    const a = Buffer.from(await this.hashPassword(String(m.password || '').slice(0, 100), u ? u.salt : 'khong-co'), 'hex');
    const b = u ? Buffer.from(u.hash, 'hex') : Buffer.alloc(0);
    if (!u || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      this.record('loginFail', conn.ip);
      return this.send(conn, { t: 'auth_err', msg: 'Sai tên đăng nhập hoặc mật khẩu' });
    }
    if (!conn.closed) this.bind(conn, key, this.newToken(key));
  }

  h_logout(conn) {
    if (conn.token) { delete this.db.sessions[conn.token]; this.store.save(); }
    this.unbind(conn);
    conn.token = null;
    this.send(conn, { t: 'guest' });
  }

  bind(conn, key, token) {
    if (conn.user) this.unbind(conn);
    conn.user = key;
    conn.token = token;
    let set = this.online.get(key);
    const first = !set;
    if (!set) this.online.set(key, (set = new Set()));
    set.add(conn);
    this.clearTimer(key);
    this.send(conn, { t: 'auth_ok', token, me: this.meFull(key) });
    this.send(conn, Object.assign({ t: 'friends' }, this.friendsPayload(key)));
    for (const ch of this.challenges.values()) {
      if (ch.to === key) this.send(conn, { t: 'challenge_in', ch: this.chPublic(ch) });
      if (ch.from === key) this.send(conn, { t: 'challenge_out', ch: this.chPublic(ch) });
    }
    const q = this.queue.get(key);
    this.send(conn, { t: 'queue', on: !!q, variant: q ? q.variant : null, since: q ? q.since : null });
    const room = this.roomOfUser(key);
    if (room) {
      this.send(conn, { t: 'room', room: this.roomPublic(room, key) });
      this.send(conn, { t: 'chat_history', list: room.chat });
      if (first) { this.sys(room, this.nameOf(key) + ' đã kết nối lại'); this.broadcastRoom(room); }
    }
    if (first) this.notifyFriends(key);
    this.roomsDirty = true;
  }

  unbind(conn) {
    const key = conn.user;
    if (!key) return;
    conn.user = null;
    const set = this.online.get(key);
    if (set) set.delete(conn);
    if (set && set.size) return;
    this.online.delete(key);
    this.queue.delete(key);
    for (const ch of [...this.challenges.values()]) {
      if (ch.from === key || ch.to === key) this.dropChallenge(ch, this.nameOf(key) + ' đã ngoại tuyến');
    }
    const room = this.roomOfUser(key);
    if (room) {
      if (this.isPlaying(key)) {
        this.sys(room, this.nameOf(key) + ' mất kết nối – có ' + ABANDON_MS / 1000 + ' giây để quay lại');
        this.setTimer(key, ABANDON_MS, () => {
          const rm = this.roomOfUser(key);
          if (!rm) return;
          if (this.isPlaying(key)) {
            const seat = rm.game.players.r === key ? 'r' : 'b';
            this.finishGame(rm, X.other(seat), 'abandon');
          }
          this.leaveRoom(key);
        });
      } else {
        this.setTimer(key, IDLE_LEAVE_MS, () => this.leaveRoom(key));
      }
      this.broadcastRoom(room);
    }
    this.notifyFriends(key);
    this.roomsDirty = true;
  }

  setTimer(key, ms, fn) {
    this.clearTimer(key);
    this.timers.set(key, setTimeout(() => { this.timers.delete(key); if (!this.online.has(key)) fn(); }, ms));
  }
  clearTimer(key) {
    const t = this.timers.get(key);
    if (t) { clearTimeout(t); this.timers.delete(key); }
  }

  // ───────────────────────── Hồ sơ, xếp hạng, tìm kiếm ─────────────────────────
  h_profile(conn, m) {
    const key = this.keyOf(m.name);
    const u = this.user(key);
    if (!u) return this.err(conn, 'Không tìm thấy người chơi');
    const byId = new Map(this.db.games.map(g => [g.id, g]));
    const recent = [];
    for (const id of u.recent) {
      const g = byId.get(id);
      if (!g) continue;
      const color = this.keyOf(g.red) === key ? 'r' : 'b';
      recent.push({
        id: g.id, date: g.date, variant: g.variant, rated: g.rated, color,
        opponent: color === 'r' ? g.black : g.red,
        outcome: g.result === 'draw' ? 'draw' : g.result === color ? 'win' : 'loss',
        reason: g.reason, delta: g.changes ? g.changes[color] : null, plies: g.moves.length
      });
    }
    const me = this.meFull(key);
    const rel = conn.user ? this.relation(conn.user, key) : 'none';
    this.send(conn, { t: 'profile', profile: Object.assign(me, { recent, relation: rel, status: this.status(key), roomId: this.userRoom.get(key) || null }) });
  }

  h_game_get(conn, m) {
    const g = this.db.games.find(x => x.id === Number(m.id));
    if (!g) return this.err(conn, 'Không tìm thấy ván cờ');
    this.send(conn, { t: 'game_record', game: g });
  }

  h_leaderboard(conn) {
    const list = Object.keys(this.db.users)
      .map(k => this.db.users[k])
      .sort((a, b) => b.points - a.points || b.wins - a.wins || a.created - b.created)
      .slice(0, 100)
      .map((u, i) => Object.assign(this.brief(this.keyOf(u.name)), { no: i + 1, wins: u.wins, losses: u.losses, draws: u.draws, bestStreak: u.bestStreak }));
    this.send(conn, { t: 'leaderboard', list });
  }

  relation(a, b) {
    const u = this.user(a);
    if (!u || a === b) return 'self';
    if (u.friends.includes(b)) return 'friend';
    if (u.inReq.includes(b)) return 'incoming';
    if (u.outReq.includes(b)) return 'outgoing';
    return 'none';
  }

  h_user_search(conn, m) {
    const q = this.keyOf(m.q).slice(0, 20);
    if (!q) return this.send(conn, { t: 'search', list: [] });
    const list = Object.keys(this.db.users)
      .filter(k => k !== conn.user && k.includes(q))
      .sort((a, b) => (a.startsWith(q) ? 0 : 1) - (b.startsWith(q) ? 0 : 1) || a.localeCompare(b))
      .slice(0, 20)
      .map(k => Object.assign(this.brief(k), { relation: this.relation(conn.user, k) }));
    this.send(conn, { t: 'search', list });
  }

  // ───────────────────────── Bạn bè ─────────────────────────
  friendsPayload(key) {
    const u = this.user(key);
    const friends = u.friends.filter(k => this.user(k)).map(k => {
      const room = this.roomOfUser(k);
      const watchable = room && !room.password && !room.private;
      return Object.assign(this.brief(k), { status: this.status(k), roomId: watchable ? room.id : null });
    });
    const order = { playing: 0, room: 1, queue: 2, online: 3, offline: 4 };
    friends.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
    return {
      friends,
      incoming: u.inReq.filter(k => this.user(k)).map(k => this.brief(k)),
      outgoing: u.outReq.filter(k => this.user(k)).map(k => this.brief(k))
    };
  }

  pushFriends(key) {
    if (this.online.has(key)) this.sendUser(key, Object.assign({ t: 'friends' }, this.friendsPayload(key)));
  }

  notifyFriends(key) {
    const u = this.user(key);
    if (!u) return;
    for (const f of u.friends) this.pushFriends(f);
  }

  h_friend_request(conn, m) {
    const me = conn.user, key = this.keyOf(m.name), u = this.user(me), o = this.user(key);
    if (!o) return this.err(conn, 'Không tìm thấy người chơi');
    if (key === me) return this.err(conn, 'Không thể kết bạn với chính mình');
    if (u.friends.includes(key)) return this.err(conn, 'Hai bạn đã là bạn bè');
    if (u.inReq.includes(key)) return this.h_friend_respond(conn, { name: key, accept: true });
    if (!u.outReq.includes(key)) u.outReq.push(key);
    if (!o.inReq.includes(me)) o.inReq.push(me);
    this.store.save();
    this.pushFriends(me);
    this.pushFriends(key);
    this.toast(key, u.name + ' muốn kết bạn với bạn', 'friend');
    this.toast(me, 'Đã gửi lời mời kết bạn tới ' + o.name, 'success');
  }

  h_friend_respond(conn, m) {
    const me = conn.user, key = this.keyOf(m.name), u = this.user(me), o = this.user(key);
    if (!o || !u.inReq.includes(key)) return;
    u.inReq = u.inReq.filter(k => k !== key);
    o.outReq = o.outReq.filter(k => k !== me);
    if (m.accept) {
      if (!u.friends.includes(key)) u.friends.push(key);
      if (!o.friends.includes(me)) o.friends.push(me);
      this.toast(key, u.name + ' đã đồng ý kết bạn', 'success');
    }
    this.store.save();
    this.pushFriends(me);
    this.pushFriends(key);
  }

  h_friend_remove(conn, m) {
    const me = conn.user, key = this.keyOf(m.name), u = this.user(me), o = this.user(key);
    if (!o) return;
    u.friends = u.friends.filter(k => k !== key);
    u.outReq = u.outReq.filter(k => k !== key);
    u.inReq = u.inReq.filter(k => k !== key);
    o.friends = o.friends.filter(k => k !== me);
    o.inReq = o.inReq.filter(k => k !== me);
    o.outReq = o.outReq.filter(k => k !== me);
    this.store.save();
    this.pushFriends(me);
    this.pushFriends(key);
  }

  // ───────────────────────── Thách đấu bạn bè ─────────────────────────
  chPublic(ch) {
    return { id: ch.id, from: this.nameOf(ch.from), to: this.nameOf(ch.to), variant: ch.variant, time: ch.time, inc: ch.inc, rated: ch.rated, expires: ch.created + CHALLENGE_MS };
  }

  dropChallenge(ch, msg) {
    this.challenges.delete(ch.id);
    this.sendUser(ch.from, { t: 'challenge_gone', id: ch.id, msg });
    this.sendUser(ch.to, { t: 'challenge_gone', id: ch.id, msg });
  }

  h_challenge(conn, m) {
    const me = conn.user, key = this.keyOf(m.name);
    if (!this.user(key) || key === me) return this.err(conn, 'Không tìm thấy người chơi');
    if (!this.user(me).friends.includes(key)) return this.err(conn, 'Chỉ thách đấu được bạn bè');
    if (!this.online.has(key)) return this.err(conn, this.nameOf(key) + ' đang ngoại tuyến');
    if (this.isPlaying(me)) return this.err(conn, 'Bạn đang trong một ván cờ');
    if (this.isPlaying(key)) return this.err(conn, this.nameOf(key) + ' đang bận chơi');
    for (const ch of this.challenges.values()) if (ch.from === me && ch.to === key) return this.err(conn, 'Bạn đã gửi lời thách đấu rồi');
    const ch = {
      id: crypto.randomBytes(6).toString('hex'), from: me, to: key,
      variant: m.variant === 'up' ? 'up' : 'thuong',
      time: pick(m.time, TIME_OPTIONS, 10), inc: pick(m.inc, INC_OPTIONS, 0),
      rated: !!m.rated, created: Date.now()
    };
    this.challenges.set(ch.id, ch);
    this.sendUser(key, { t: 'challenge_in', ch: this.chPublic(ch) });
    this.sendUser(me, { t: 'challenge_out', ch: this.chPublic(ch) });
  }

  h_challenge_cancel(conn, m) {
    const ch = this.challenges.get(m.id);
    if (ch && ch.from === conn.user) this.dropChallenge(ch, this.nameOf(ch.from) + ' đã hủy lời thách đấu');
  }

  h_challenge_respond(conn, m) {
    const ch = this.challenges.get(m.id);
    if (!ch || ch.to !== conn.user) return this.err(conn, 'Lời thách đấu không còn hiệu lực');
    if (!m.accept) return this.dropChallenge(ch, this.nameOf(ch.to) + ' đã từ chối lời thách đấu');
    if (this.isPlaying(ch.from) || this.isPlaying(ch.to)) return this.dropChallenge(ch, 'Một trong hai người đang bận chơi');
    if (!this.online.has(ch.from)) return this.dropChallenge(ch, this.nameOf(ch.from) + ' đã ngoại tuyến');
    this.challenges.delete(ch.id);
    this.sendUser(ch.from, { t: 'challenge_gone', id: ch.id, accepted: true });
    this.sendUser(ch.to, { t: 'challenge_gone', id: ch.id, accepted: true });
    const room = this.createRoom({
      name: this.nameOf(ch.from) + ' ⚔ ' + this.nameOf(ch.to), variant: ch.variant,
      time: ch.time, inc: ch.inc, rated: ch.rated, kind: 'challenge'
    }, ch.from);
    this.seatPair(room, ch.from, ch.to);
  }

  // ───────────────────────── Ghép trận ngẫu nhiên ─────────────────────────
  h_queue_join(conn, m) {
    const me = conn.user;
    if (this.isPlaying(me)) return this.err(conn, 'Bạn đang trong một ván cờ');
    if (this.userRoom.has(me)) this.leaveRoom(me);
    const variant = m.variant === 'up' ? 'up' : 'thuong';
    const q = { key: me, variant, since: Date.now() };
    this.queue.set(me, q);
    this.sendUser(me, { t: 'queue', on: true, variant, since: q.since });
    this.notifyFriends(me);
  }

  h_queue_leave(conn) {
    this.queue.delete(conn.user);
    this.sendUser(conn.user, { t: 'queue', on: false });
    this.notifyFriends(conn.user);
  }

  matchmake() {
    if (this.queue.size < 2) return;
    const now = Date.now();
    const allow = q => 150 + 30 * (now - q.since) / 1000;
    for (const variant of ['thuong', 'up']) {
      const list = [...this.queue.values()].filter(q => q.variant === variant)
        .sort((a, b) => this.user(a.key).points - this.user(b.key).points);
      const used = new Set();
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (used.has(a.key)) continue;
        let best = null, bestDiff = Infinity;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (used.has(b.key)) continue;
          const diff = Math.abs(this.user(a.key).points - this.user(b.key).points);
          if (diff <= Math.min(allow(a), allow(b)) && diff < bestDiff) { best = b; bestDiff = diff; }
        }
        if (!best) continue;
        used.add(a.key); used.add(best.key);
        this.queue.delete(a.key); this.queue.delete(best.key);
        for (const k of [a.key, best.key]) this.sendUser(k, { t: 'queue', on: false, matched: true });
        const room = this.createRoom({ name: 'Đấu ngẫu nhiên – ' + X.VARIANTS[variant], variant, time: MATCH_TIME, inc: MATCH_INC, rated: true, kind: 'match' }, a.key);
        this.seatPair(room, a.key, best.key);
      }
    }
  }

  /** Đưa 2 người vào phòng mới (màu ngẫu nhiên) và bắt đầu ván ngay. */
  seatPair(room, a, b) {
    const [red, black] = Math.random() < 0.5 ? [a, b] : [b, a];
    for (const k of [a, b]) {
      if (this.userRoom.has(k)) this.leaveRoom(k);
      this.queue.delete(k);
      room.members.add(k);
      this.userRoom.set(k, room.id);
      this.clearTimer(k);
    }
    room.seats.r = red;
    room.seats.b = black;
    this.startGame(room);
    for (const k of [a, b]) this.sendUser(k, { t: 'chat_history', list: room.chat });
  }

  // ───────────────────────── Phòng chơi ─────────────────────────
  roomOfUser(key) {
    const id = this.userRoom.get(key);
    return id ? this.rooms.get(id) || null : null;
  }

  seatOf(room, key) {
    if (room.seats.r === key) return 'r';
    if (room.seats.b === key) return 'b';
    if (room.referee === key) return 'referee';
    return room.members.has(key) ? 'spectator' : null;
  }

  active(room) { return !!(room.game && room.game.status === 'playing'); }

  roomOptions(m, base) {
    base = base || {};
    return {
      name: clean(m.name, 40) || base.name,
      variant: m.variant === 'up' ? 'up' : m.variant === 'thuong' ? 'thuong' : (base.variant || 'thuong'),
      time: pick(m.time, TIME_OPTIONS, base.time != null ? base.time : 10),
      inc: pick(m.inc, INC_OPTIONS, base.inc != null ? base.inc : 0),
      rated: m.rated != null ? !!m.rated : !!base.rated,
      password: m.password != null ? clean(m.password, 20) : (base.password || ''),
      private: m.private != null ? !!m.private : !!base.private
    };
  }

  createRoom(opts, owner) {
    const id = String(this.roomSeq++);
    const room = Object.assign({
      id, owner, kind: opts.kind || 'room',
      seats: { r: null, b: null }, referee: null,
      members: new Set(), banned: new Set(), invited: new Set(),
      ready: { r: false, b: false }, game: null, chat: [],
      lastResult: null, lastPlayers: null, created: Date.now()
    }, this.roomOptions(opts, { name: 'Phòng ' + id }));
    this.rooms.set(id, room);
    this.roomsDirty = true;
    return room;
  }

  roomPublic(room, viewer) {
    const g = room.game;
    let game = null;
    if (g) {
      const clocks = { r: g.clocks.r, b: g.clocks.b };
      const running = g.status === 'playing' && !g.paused && room.time > 0;
      if (running) clocks[g.turn] = Math.max(0, clocks[g.turn] - (Date.now() - g.turnStart));
      game = Object.assign(X.publicState(g), {
        id: g.id, rated: g.rated,
        players: { r: this.brief(g.players.r), b: this.brief(g.players.b) },
        clocks, running, paused: g.paused, drawOffer: g.drawOffer, undoReq: g.undoReq, note: g.note || null
      });
    }
    const spectators = [];
    for (const k of room.members) if (k !== room.seats.r && k !== room.seats.b && k !== room.referee) spectators.push(this.brief(k));
    return {
      id: room.id, name: room.name, kind: room.kind, owner: this.nameOf(room.owner), ownerKey: room.owner,
      variant: room.variant, time: room.time, inc: room.inc, rated: room.rated,
      hasPassword: !!room.password, private: room.private,
      password: viewer === room.owner ? room.password : undefined,
      seats: { r: this.brief(room.seats.r), b: this.brief(room.seats.b) },
      referee: this.brief(room.referee), spectators, ready: room.ready,
      game, lastResult: room.lastResult,
      allowUndo: !room.rated && room.variant === 'thuong',
      you: this.seatOf(room, viewer), isOwner: viewer === room.owner
    };
  }

  roomSummary(room) {
    const g = room.game;
    let spectators = 0;
    for (const k of room.members) if (k !== room.seats.r && k !== room.seats.b && k !== room.referee) spectators++;
    return {
      id: room.id, name: room.name, kind: room.kind, owner: this.nameOf(room.owner),
      variant: room.variant, time: room.time, inc: room.inc, rated: room.rated, hasPassword: !!room.password,
      red: this.brief(room.seats.r), black: this.brief(room.seats.b),
      referee: room.referee ? this.nameOf(room.referee) : null,
      spectators, members: room.members.size,
      playing: this.active(room), plies: g ? g.moves.length : 0
    };
  }

  broadcastRoom(room) {
    for (const k of room.members) this.sendUser(k, { t: 'room', room: this.roomPublic(room, k) });
    this.roomsDirty = true;
  }

  sys(room, text) { this.chatPush(room, { from: null, role: 'sys', text, ts: Date.now() }); }

  chatPush(room, msg) {
    room.chat.push(msg);
    if (room.chat.length > 80) room.chat.splice(0, room.chat.length - 80);
    for (const k of room.members) this.sendUser(k, { t: 'chat', msg });
  }

  h_room_watch(conn, m) {
    conn.watchRooms = !!m.on;
    if (conn.watchRooms) this.send(conn, { t: 'rooms', list: this.roomList(), stats: this.stats() });
  }

  roomList() {
    return [...this.rooms.values()].filter(r => !r.private).map(r => this.roomSummary(r))
      .sort((a, b) => (a.playing === b.playing ? 0 : a.playing ? 1 : -1) || Number(b.id) - Number(a.id));
  }

  h_room_create(conn, m) {
    const me = conn.user;
    if (this.isPlaying(me)) return this.err(conn, 'Bạn đang trong một ván cờ');
    if (this.rooms.size >= MAX_ROOMS) return this.err(conn, 'Máy chủ đã đủ số phòng, hãy thử lại sau');
    if (this.userRoom.has(me)) this.leaveRoom(me);
    this.queue.delete(me);
    const room = this.createRoom(Object.assign({}, m, { name: clean(m.name, 40) || 'Phòng của ' + this.nameOf(me), kind: 'room' }), me);
    const seat = ['r', 'b', 'referee', 'spectator'].includes(m.seat) ? m.seat : 'r';
    this.enterRoom(me, room, seat);
  }

  h_room_join(conn, m) {
    const me = conn.user, room = this.rooms.get(String(m.id));
    if (!room) return this.err(conn, 'Phòng không còn tồn tại');
    if (this.userRoom.get(me) === room.id) {
      if (m.as) { const e = this.sit(room, me, m.as); if (e) this.err(conn, e); this.broadcastRoom(room); }
      else this.send(conn, { t: 'room', room: this.roomPublic(room, me) });
      return;
    }
    if (this.isPlaying(me)) return this.err(conn, 'Bạn đang trong một ván cờ ở phòng khác');
    if (room.banned.has(me)) return this.err(conn, 'Bạn đã bị mời ra khỏi phòng này');
    if (room.password && !room.invited.has(me) && room.owner !== me && String(m.password || '') !== room.password) {
      return this.send(conn, { t: 'error', msg: m.password ? 'Sai mật khẩu phòng' : 'Phòng có mật khẩu', code: 'password', roomId: room.id });
    }
    if (this.userRoom.has(me)) this.leaveRoom(me);
    this.queue.delete(me);
    this.enterRoom(me, room, m.as || 'spectator');
  }

  enterRoom(key, room, seat) {
    room.members.add(key);
    this.userRoom.set(key, room.id);
    this.clearTimer(key);
    let note = null;
    if (seat && seat !== 'spectator') note = this.sit(room, key, seat);
    this.sys(room, this.nameOf(key) + ' đã vào phòng');
    this.sendUser(key, { t: 'chat_history', list: room.chat });
    this.broadcastRoom(room);
    if (note) this.toast(key, note + ' – bạn đang ở chế độ quan sát', 'warn');
    this.notifyFriends(key);
    this.sendUser(key, { t: 'queue', on: false });
  }

  h_room_leave(conn) { this.leaveRoom(conn.user); }

  leaveRoom(key, opts) {
    opts = opts || {};
    const room = this.roomOfUser(key);
    this.userRoom.delete(key);
    this.clearTimer(key);
    if (!room) { this.sendUser(key, { t: 'room_left', msg: opts.msg || null }); return; }
    const seat = this.seatOf(room, key);
    if (this.active(room) && (room.game.players.r === key || room.game.players.b === key)) {
      this.finishGame(room, X.other(seat), opts.reason || 'leave');
    }
    if (room.seats.r === key) { room.seats.r = null; room.ready.r = false; }
    if (room.seats.b === key) { room.seats.b = null; room.ready.b = false; }
    if (room.referee === key) room.referee = null;
    room.members.delete(key);
    if (room.members.size === 0) {
      this.rooms.delete(room.id);
    } else {
      if (room.owner === key) {
        room.owner = room.seats.r || room.seats.b || room.referee || room.members.values().next().value;
        this.sys(room, this.nameOf(room.owner) + ' trở thành chủ phòng');
      }
      this.sys(room, this.nameOf(key) + ' đã rời phòng');
      this.broadcastRoom(room);
    }
    this.roomsDirty = true;
    this.sendUser(key, { t: 'room_left', msg: opts.msg || null });
    this.notifyFriends(key);
  }

  sit(room, key, seat) {
    const active = this.active(room);
    const playing = active && (room.game.players.r === key || room.game.players.b === key);
    if (seat === 'spectator') {
      if (playing) return 'Bạn đang chơi, không thể đứng dậy';
      if (room.seats.r === key) { room.seats.r = null; room.ready.r = false; }
      if (room.seats.b === key) { room.seats.b = null; room.ready.b = false; }
      if (room.referee === key) room.referee = null;
      return null;
    }
    if (seat === 'referee') {
      if (room.referee && room.referee !== key) return 'Phòng đã có trọng tài';
      if (playing) return 'Bạn đang chơi, không thể làm trọng tài';
      if (room.seats.r === key) { room.seats.r = null; room.ready.r = false; }
      if (room.seats.b === key) { room.seats.b = null; room.ready.b = false; }
      room.referee = key;
      return null;
    }
    if (seat !== 'r' && seat !== 'b') return 'Ghế không hợp lệ';
    if (active) return 'Ván đang diễn ra, chưa thể ngồi vào ghế';
    if (room.seats[seat] && room.seats[seat] !== key) return 'Ghế ' + colorName(seat) + ' đã có người';
    if (room.referee === key) room.referee = null;
    const o = X.other(seat);
    if (room.seats[o] === key) { room.seats[o] = null; room.ready[o] = false; }
    room.seats[seat] = key;
    room.ready[seat] = false;
    room.lastPlayers = null;
    return null;
  }

  h_room_sit(conn, m) {
    const room = this.roomOfUser(conn.user);
    if (!room) return;
    const e = this.sit(room, conn.user, m.seat);
    if (e) return this.err(conn, e);
    const label = { r: 'ghế Đỏ', b: 'ghế Đen', referee: 'ghế trọng tài', spectator: 'hàng quan sát' }[m.seat];
    this.sys(room, this.nameOf(conn.user) + ' chuyển sang ' + label);
    this.broadcastRoom(room);
  }

  h_room_ready(conn, m) {
    const me = conn.user, room = this.roomOfUser(me);
    if (!room || this.active(room)) return;
    const seat = this.seatOf(room, me);
    if (seat !== 'r' && seat !== 'b') return;
    room.ready[seat] = !!m.ready;
    if (room.ready.r && room.ready.b && room.seats.r && room.seats.b) {
      if (room.referee) {
        this.sys(room, 'Hai bên đã sẵn sàng – chờ trọng tài ' + this.nameOf(room.referee) + ' bắt đầu ván');
        this.toast(room.referee, 'Hai kỳ thủ đã sẵn sàng. Hãy bấm "Bắt đầu ván".', 'info');
      } else return this.startGame(room);
    }
    this.broadcastRoom(room);
  }

  h_room_settings(conn, m) {
    const room = this.roomOfUser(conn.user);
    if (!room || room.owner !== conn.user) return this.err(conn, 'Chỉ chủ phòng được đổi cài đặt');
    if (this.active(room)) return this.err(conn, 'Không thể đổi cài đặt khi đang có ván');
    Object.assign(room, this.roomOptions(m, room));
    room.ready = { r: false, b: false };
    this.sys(room, 'Chủ phòng đã đổi cài đặt: ' + X.VARIANTS[room.variant] + ', ' + (room.time ? room.time + ' phút' : 'không giới hạn') + (room.inc ? ' +' + room.inc + 's' : '') + (room.rated ? ', tính điểm' : ', giao hữu'));
    this.broadcastRoom(room);
  }

  h_room_kick(conn, m) {
    const me = conn.user, room = this.roomOfUser(me), key = this.keyOf(m.name);
    if (!room || !room.members.has(key) || key === me) return;
    if (room.owner !== me && room.referee !== me) return this.err(conn, 'Chỉ chủ phòng hoặc trọng tài được mời người khác ra');
    if (key === room.owner) return this.err(conn, 'Không thể mời chủ phòng ra');
    if (this.active(room) && (room.game.players.r === key || room.game.players.b === key)) return this.err(conn, 'Không thể mời kỳ thủ ra khi đang chơi');
    room.banned.add(key);
    this.sys(room, this.nameOf(key) + ' đã bị mời ra khỏi phòng');
    this.leaveRoom(key, { msg: 'Bạn đã bị mời ra khỏi phòng "' + room.name + '"' });
  }

  h_room_invite(conn, m) {
    const me = conn.user, room = this.roomOfUser(me), key = this.keyOf(m.name);
    if (!room) return this.err(conn, 'Bạn chưa ở trong phòng nào');
    if (!this.user(key)) return this.err(conn, 'Không tìm thấy người chơi');
    if (!this.online.has(key)) return this.err(conn, this.nameOf(key) + ' đang ngoại tuyến');
    room.invited.add(key);
    room.banned.delete(key);
    this.sendUser(key, { t: 'invite', from: this.nameOf(me), room: { id: room.id, name: room.name, variant: room.variant } });
    this.toast(me, 'Đã mời ' + this.nameOf(key) + ' vào phòng', 'success');
  }

  h_chat(conn, m) {
    const me = conn.user, room = this.roomOfUser(me);
    if (!room) return;
    const text = clean(m.text, 300);
    if (!text) return;
    const now = Date.now();
    if (conn.lastChat && now - conn.lastChat < 400) return;
    conn.lastChat = now;
    this.chatPush(room, { from: this.nameOf(me), role: this.seatOf(room, me), text, ts: now });
  }

  // ───────────────────────── Ván cờ ─────────────────────────
  startGame(room) {
    const lp = room.lastPlayers;
    if (lp && room.seats.r === lp.r && room.seats.b === lp.b) {
      room.seats = { r: lp.b, b: lp.r };
      this.sys(room, 'Đổi bên: ' + this.nameOf(room.seats.r) + ' cầm quân Đỏ');
    }
    const g = X.createGame(room.variant);
    g.id = this.db.seq++;
    this.store.save();
    g.players = { r: room.seats.r, b: room.seats.b };
    g.rated = room.rated;
    g.clocks = { r: room.time * 60000, b: room.time * 60000 };
    g.turnStart = Date.now();
    g.paused = false;
    g.drawOffer = null;
    g.undoReq = null;
    room.game = g;
    room.ready = { r: false, b: false };
    room.lastResult = null;
    room.lastPlayers = { r: g.players.r, b: g.players.b };
    this.sys(room, 'Ván ' + X.VARIANTS[room.variant] + (room.rated ? ' tính điểm' : ' giao hữu') + ' bắt đầu: ' + this.nameOf(g.players.r) + ' (Đỏ) – ' + this.nameOf(g.players.b) + ' (Đen)');
    this.broadcastRoom(room);
    for (const k of [g.players.r, g.players.b]) this.notifyFriends(k);
  }

  gameCtx(conn, needSeat) {
    const room = this.roomOfUser(conn.user);
    if (!room || !this.active(room)) return null;
    const seat = this.seatOf(room, conn.user);
    if (needSeat === 'player' && seat !== 'r' && seat !== 'b') return null;
    if (needSeat === 'referee' && seat !== 'referee') return null;
    return { room, g: room.game, seat };
  }

  h_move(conn, m) {
    const ctx = this.gameCtx(conn, 'player');
    if (!ctx) return;
    const { room, g, seat } = ctx;
    if (g.paused) return this.err(conn, 'Ván đang tạm dừng');
    if (seat !== g.turn) return this.err(conn, 'Chưa tới lượt bạn');
    const now = Date.now(), timed = room.time > 0;
    if (timed && g.clocks[seat] - (now - g.turnStart) <= 0) return this.finishGame(room, X.other(seat), 'timeout');
    const res = X.makeMove(g, Number(m.from), Number(m.to));
    if (!res.ok) {
      this.err(conn, res.error);
      return this.send(conn, { t: 'room', room: this.roomPublic(room, conn.user) });
    }
    if (timed) g.clocks[seat] = g.clocks[seat] - (now - g.turnStart) + room.inc * 1000;
    g.turnStart = now;
    g.drawOffer = null;
    g.undoReq = null;
    if (g.status === 'ended') this.finishGame(room, g.result, g.reason);
    else this.broadcastRoom(room);
  }

  h_resign(conn) {
    const ctx = this.gameCtx(conn, 'player');
    if (ctx) this.finishGame(ctx.room, X.other(ctx.seat), 'resign');
  }

  h_draw_offer(conn) {
    const ctx = this.gameCtx(conn, 'player');
    if (!ctx || ctx.g.drawOffer) return;
    if (ctx.g.moves.length < 2) return this.err(conn, 'Chưa thể cầu hòa ngay đầu ván');
    ctx.g.drawOffer = ctx.seat;
    this.sys(ctx.room, this.nameOf(conn.user) + ' cầu hòa');
    this.broadcastRoom(ctx.room);
  }

  h_draw_respond(conn, m) {
    const ctx = this.gameCtx(conn, 'player');
    if (!ctx || !ctx.g.drawOffer || ctx.g.drawOffer === ctx.seat) return;
    if (m.accept) return this.finishGame(ctx.room, 'draw', 'agreement');
    ctx.g.drawOffer = null;
    this.sys(ctx.room, this.nameOf(conn.user) + ' từ chối hòa');
    this.broadcastRoom(ctx.room);
  }

  h_undo_request(conn) {
    const ctx = this.gameCtx(conn, 'player');
    if (!ctx) return;
    const { room, g, seat } = ctx;
    if (room.rated || room.variant !== 'thuong') return this.err(conn, 'Ván tính điểm hoặc cờ úp không được đi lại');
    if (g.undoReq) return;
    if (!g.moves.some(mv => mv.color === seat)) return this.err(conn, 'Bạn chưa đi nước nào');
    g.undoReq = seat;
    this.sys(room, this.nameOf(conn.user) + ' xin đi lại');
    this.broadcastRoom(room);
  }

  h_undo_respond(conn, m) {
    const ctx = this.gameCtx(conn, 'player');
    if (!ctx) return;
    const { room, g, seat } = ctx;
    if (!g.undoReq || g.undoReq === seat) return;
    const req = g.undoReq;
    g.undoReq = null;
    if (!m.accept) {
      this.sys(room, this.nameOf(conn.user) + ' không cho đi lại');
      return this.broadcastRoom(room);
    }
    const now = Date.now();
    if (room.time > 0 && !g.paused) g.clocks[g.turn] = Math.max(1000, g.clocks[g.turn] - (now - g.turnStart));
    const plies = g.turn === req ? 2 : 1;
    X.undo(g, Math.min(plies, g.moves.length));
    g.turnStart = now;
    this.sys(room, 'Đã cho ' + this.nameOf(g.players[req]) + ' đi lại');
    this.broadcastRoom(room);
  }

  // ───────────────────────── Trọng tài ─────────────────────────
  h_ref_start(conn) {
    const room = this.roomOfUser(conn.user);
    if (!room || room.referee !== conn.user) return this.err(conn, 'Bạn không phải trọng tài');
    if (this.active(room)) return;
    if (!room.seats.r || !room.seats.b) return this.err(conn, 'Cần đủ hai kỳ thủ');
    if (!room.ready.r || !room.ready.b) return this.err(conn, 'Hai kỳ thủ chưa sẵn sàng');
    this.startGame(room);
  }

  h_ref_pause(conn, m) {
    const ctx = this.gameCtx(conn, 'referee');
    if (!ctx) return this.err(conn, 'Không có ván đang diễn ra');
    const { room, g } = ctx, now = Date.now();
    if (m.pause && !g.paused) {
      if (room.time > 0) g.clocks[g.turn] = Math.max(0, g.clocks[g.turn] - (now - g.turnStart));
      g.paused = true;
      this.sys(room, '⏸ Trọng tài tạm dừng ván' + (m.note ? ': ' + clean(m.note, 120) : ''));
    } else if (!m.pause && g.paused) {
      g.paused = false;
      g.turnStart = now;
      this.sys(room, '▶ Trọng tài cho tiếp tục ván');
    }
    this.broadcastRoom(room);
  }

  h_ref_decide(conn, m) {
    const ctx = this.gameCtx(conn, 'referee');
    if (!ctx) return this.err(conn, 'Không có ván đang diễn ra');
    if (!['r', 'b', 'draw'].includes(m.result)) return;
    this.finishGame(ctx.room, m.result, 'referee', clean(m.note, 160) || null);
  }

  h_ref_warn(conn, m) {
    const ctx = this.gameCtx(conn, 'referee');
    if (!ctx || (m.seat !== 'r' && m.seat !== 'b')) return;
    const target = ctx.g.players[m.seat];
    const note = clean(m.note, 160) || 'Hãy giữ tinh thần thi đấu fair-play';
    this.sys(ctx.room, '⚠ Trọng tài nhắc nhở ' + this.nameOf(target) + ': ' + note);
    this.toast(target, 'Trọng tài nhắc nhở: ' + note, 'warn');
  }

  h_ref_time(conn, m) {
    const ctx = this.gameCtx(conn, 'referee');
    if (!ctx || (m.seat !== 'r' && m.seat !== 'b') || ctx.room.time === 0) return;
    const sec = pick(m.sec, [30, 60, 120, 300], 60);
    ctx.g.clocks[m.seat] += sec * 1000;
    this.sys(ctx.room, 'Trọng tài cộng ' + sec + ' giây cho ' + this.nameOf(ctx.g.players[m.seat]));
    this.broadcastRoom(ctx.room);
  }

  // ───────────────────────── Kết thúc ván & tính điểm ─────────────────────────
  finishGame(room, result, reason, note) {
    const g = room.game;
    if (!g || g.finalized) return;
    if (g.status === 'playing') {
      if (room.time > 0 && !g.paused) g.clocks[g.turn] = Math.max(0, g.clocks[g.turn] - (Date.now() - g.turnStart));
      g.status = 'ended';
      g.result = result;
      g.reason = reason;
    }
    g.finalized = true;
    g.note = note || null;
    g.drawOffer = null;
    g.undoReq = null;
    g.paused = false;
    const changes = g.rated ? this.applyRating(g) : null;
    if (!g.rated) for (const c of ['r', 'b']) { const u = this.user(g.players[c]); if (u) u.casual++; }
    this.recordGame(g, changes);
    room.lastResult = { result: g.result, reason: g.reason, note: g.note, changes };
    const rtext = g.result === 'draw' ? 'Hòa' : colorName(g.result) + ' (' + this.nameOf(g.players[g.result]) + ') thắng';
    this.sys(room, '🏁 Kết thúc: ' + rtext + ' – ' + (X.REASONS[g.reason] || g.reason) + (g.note ? ' (' + g.note + ')' : ''));
    for (const k of room.members) {
      this.sendUser(k, {
        t: 'game_over', gameId: g.id, result: g.result, reason: g.reason, note: g.note, rated: g.rated,
        changes, you: this.seatOf(room, k), players: { r: this.nameOf(g.players.r), b: this.nameOf(g.players.b) }
      });
    }
    this.broadcastRoom(room);
    for (const k of [g.players.r, g.players.b]) {
      this.sendUser(k, { t: 'me', me: this.meFull(k) });
      this.notifyFriends(k);
    }
  }

  applyRating(g) {
    const res = {};
    const pts = { r: this.user(g.players.r).points, b: this.user(g.players.b).points };
    for (const c of ['r', 'b']) {
      const u = this.user(g.players[c]);
      const score = g.result === 'draw' ? 0.5 : g.result === c ? 1 : 0;
      const tierBefore = R.tierIndex(u.points);
      if (score === 1) { u.wins++; u.streak++; u.bestStreak = Math.max(u.bestStreak, u.streak); }
      else if (score === 0) { u.losses++; u.streak = 0; }
      else { u.draws++; u.streak = 0; }
      const before = u.points;
      u.points = Math.max(0, u.points + R.pointDelta(pts[c], pts[X.other(c)], score, u.streak));
      const nt = R.newTitles(u);
      u.titles.push(...nt);
      res[c] = { delta: u.points - before, before, after: u.points, tierBefore, tierAfter: R.tierIndex(u.points), streak: u.streak, newTitles: nt };
    }
    this.store.save();
    return res;
  }

  recordGame(g, changes) {
    const rec = {
      id: g.id, date: Date.now(), variant: g.variant, rated: g.rated,
      red: this.nameOf(g.players.r), black: this.nameOf(g.players.b),
      result: g.result, reason: g.reason, note: g.note,
      moves: g.moves.map(m => [m.from, m.to, m.n, m.rev || '', m.cap || '', m.capH ? 1 : 0, m.check ? 1 : 0]),
      changes: changes ? { r: changes.r.delta, b: changes.b.delta } : null
    };
    this.db.games.push(rec);
    if (this.db.games.length > 3000) this.db.games.splice(0, this.db.games.length - 3000);
    for (const c of ['r', 'b']) {
      const u = this.user(g.players[c]);
      if (!u) continue;
      u.recent.unshift(rec.id);
      if (u.recent.length > 30) u.recent.length = 30;
    }
    this.store.save();
  }

  // ───────────────────────── Vòng lặp ─────────────────────────
  tick() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const g = room.game;
      if (g && g.status === 'playing' && !g.paused && room.time > 0 && g.clocks[g.turn] - (now - g.turnStart) <= 0) {
        this.finishGame(room, X.other(g.turn), 'timeout');
      }
    }
    for (const ch of [...this.challenges.values()]) {
      if (now - ch.created > CHALLENGE_MS) this.dropChallenge(ch, 'Lời thách đấu đã hết hạn');
    }
    if (this.roomsDirty && now - this.lastRoomsPush > 700) {
      this.roomsDirty = false;
      this.lastRoomsPush = now;
      const msg = JSON.stringify({ t: 'rooms', list: this.roomList(), stats: this.stats() });
      for (const c of this.conns) if (c.watchRooms) c.send(msg);
    }
    if (now - this.lastStatsPush > 10000) {
      this.lastStatsPush = now;
      const msg = JSON.stringify({ t: 'stats', stats: this.stats() });
      for (const c of this.conns) c.send(msg);
    }
  }
}

const PUBLIC = new Set(['hello', 'register', 'login', 'logout', 'leaderboard', 'profile', 'room_watch', 'game_get']);

module.exports = Hub;
