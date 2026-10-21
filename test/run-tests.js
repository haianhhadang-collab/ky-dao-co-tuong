'use strict';
/*
 * Kiểm thử: bộ luật (perft, cờ úp, lùi nước) + mô phỏng nhiều người chơi qua WebSocket.
 * Chạy: npm test   (cần Node.js ≥ 22 vì dùng WebSocket có sẵn)
 */
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const X = require('../public/shared/xiangqi.js');
const R = require('../public/shared/ranks.js');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };

// ───────────── Bộ luật ─────────────
function perft(b, col, d) {
  if (d === 0) return 1;
  let n = 0;
  for (const m of X.legalMoves(b, col, 'thuong')) {
    const c = b.slice(); c[m.to] = c[m.from]; c[m.from] = null;
    n += perft(c, X.other(col), d - 1);
  }
  return n;
}

function rulesTests() {
  console.log('Bộ luật');
  ok(perft(X.START, 'r', 1) === 44, 'perft(1) = 44');
  ok(perft(X.START, 'r', 2) === 1920, 'perft(2) = 1920');
  ok(perft(X.START, 'r', 3) === 79666, 'perft(3) = 79666');

  // Lộ mặt tướng: tướng không được ra cột đối diện tướng địch trống
  const b = new Array(90).fill(null);
  b[X.sq(0, 4)] = 'bK'; b[X.sq(9, 3)] = 'rK'; b[X.sq(5, 0)] = 'rR';
  ok(!X.legalMovesFrom(b, X.sq(9, 3), 'thuong').some(m => m.to === X.sq(9, 4)), 'cấm lộ mặt tướng');

  // Cờ úp: quân úp đi theo vị trí, lật ra khi đi
  const g = X.createGame('up', () => 0.42);
  ok(Object.keys(g.secret).length === 30, 'cờ úp có 30 quân úp');
  ok(g.board.filter(p => p && p[1] === 'X').length === 30, 'bàn công khai không lộ danh tính');
  const res = X.makeMove(g, X.sq(9, 0), X.sq(8, 0));
  ok(res.ok && res.move.rev && g.board[X.sq(8, 0)] === 'r' + res.move.rev, 'quân úp lật mặt sau khi đi');

  // Sĩ / tượng đã lật trong cờ úp được qua sông
  const u = new Array(90).fill(null);
  u[X.sq(0, 3)] = 'bK'; u[X.sq(9, 5)] = 'rK'; u[X.sq(5, 2)] = 'rE'; u[X.sq(5, 6)] = 'rA'; u[X.sq(9, 3)] = 'rA';
  ok(X.legalMovesFrom(u, X.sq(5, 2), 'up').some(m => m.to === X.sq(3, 0)), 'tượng đã lật qua sông được (cờ úp)');
  ok(!X.legalMovesFrom(u, X.sq(5, 2), 'thuong').some(m => m.to === X.sq(3, 0)), 'tượng không qua sông (cờ thường)');
  ok(X.legalMovesFrom(u, X.sq(5, 6), 'up').some(m => m.to === X.sq(4, 7)), 'sĩ đã lật đi khắp bàn (cờ úp)');

  // Chiếu bí
  const m = new Array(90).fill(null);
  m[X.sq(0, 4)] = 'bK'; m[X.sq(9, 3)] = 'rK'; m[X.sq(2, 0)] = 'rR'; m[X.sq(1, 8)] = 'rR';
  const gm = { variant: 'thuong', board: m, turn: 'r', secret: {}, moves: [], captured: { r: [], b: [] }, keys: [X.positionKey(m, 'r')], noCapture: 0, status: 'playing', snapshots: [] };
  const r1 = X.makeMove(gm, X.sq(2, 0), X.sq(0, 0));
  ok(r1.ok && gm.status === 'ended' && gm.result === 'r' && gm.reason === 'checkmate', 'phát hiện chiếu bí');

  // Ván ngẫu nhiên + lùi về đầu
  for (let i = 0; i < 40; i++) {
    const gg = X.createGame(i % 2 ? 'up' : 'thuong');
    while (gg.status === 'playing' && gg.moves.length < 300) {
      const ms = X.legalMoves(gg.board, gg.turn, gg.variant);
      const mv = ms[Math.floor(Math.random() * ms.length)];
      assert.ok(X.makeMove(gg, mv.from, mv.to).ok);
    }
    X.undo(gg, gg.moves.length);
    assert.strictEqual(X.positionKey(gg.board, gg.turn), gg.keys[0]);
  }
  ok(true, '40 ván ngẫu nhiên hợp lệ, lùi nước về đầu chính xác');

  // Xếp hạng
  ok(R.TIERS.length === 25 && R.TIERS[0].name === 'Tập sự Nhất tinh' && R.TIERS[24].name === 'Kỳ vương Ngũ tinh', '5 hạng × 5 sao');
  ok(R.pointDelta(0, 0, 1, 1) > 0 && R.pointDelta(0, 0, 0, 0) === 0, 'thắng được cộng điểm, không bị âm điểm');
  ok(R.newTitles({ bestStreak: 3, wins: 3, points: 0, titles: [] }).includes('lien_sat'), 'thắng 3 ván liên tiếp → Liên sát');
  ok(R.bestTitle(['lien_sat', 'thap_nhan_tram', 'tu_sat']).name === 'Thập nhân trảm', 'danh hiệu cao nhất');
}

// ───────────── Mô phỏng trực tuyến ─────────────
class Client {
  constructor(url) {
    this.msgs = [];
    this.waiters = [];
    this.ws = new WebSocket(url);
    this.ws.onmessage = e => {
      const m = JSON.parse(e.data);
      this.msgs.push(m);
      for (const w of this.waiters.slice()) if (w.pred(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(m); }
    };
    this.opened = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  wait(t, pred, ms) {
    const p = typeof pred === 'function' ? pred : () => true;
    const f = m => m.t === t && p(m);
    return new Promise((resolve, reject) => {
      const w = { pred: f, resolve, timer: setTimeout(() => reject(new Error('Hết giờ chờ ' + t)), ms || 4000) };
      this.waiters.push(w);
    });
  }
  /** Gửi rồi chờ phản hồi (đăng ký chờ trước để không lỡ tin). */
  async req(m, t, pred, ms) { const w = this.wait(t, pred, ms); this.send(m); return w; }
  lastRoom() { for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === 'room') return this.msgs[i].room; return null; }
  close() { this.ws.close(); }
}

async function user(url, name) {
  const c = new Client(url);
  await c.opened;
  const r = await c.req({ t: 'register', name, password: 'matkhau' }, 'auth_ok');
  c.token = r.token;
  c.name = name;
  return c;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function onlineTests() {
  console.log('Trực tuyến');
  const PORT = 3900 + Math.floor(Math.random() * 90);
  const dataFile = path.join(os.tmpdir(), 'kydao-test-' + Date.now() + '.json');
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), DATA_FILE: dataFile, HOST: '127.0.0.1' }), stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res, rej) => { srv.stdout.on('data', d => { if (String(d).includes('localhost')) res(); }); srv.on('exit', rej); });
  const url = 'ws://127.0.0.1:' + PORT + '/ws';
  try {
    const res = await fetch('http://127.0.0.1:' + PORT + '/');
    ok(res.status === 200 && (await res.text()).includes('Kỳ Đạo'), 'phục vụ trang web tĩnh');
    ok((await fetch('http://127.0.0.1:' + PORT + '/../server.js')).status !== 200, 'chặn truy cập ngoài thư mục public');
    const hz = await fetch('http://127.0.0.1:' + PORT + '/healthz');
    ok(hz.status === 200 && (await hz.text()) === 'ok', '/healthz trả về ok');
    ok(/frame-ancestors 'none'/.test(res.headers.get('content-security-policy') || ''), 'có header bảo mật (CSP)');

    const alice = await user(url, 'alice'), bob = await user(url, 'bob'), carol = await user(url, 'carol'), dave = await user(url, 'dave');
    ok(true, 'đăng ký 4 tài khoản');
    const dup = new Client(url); await dup.opened;
    ok((await dup.req({ t: 'register', name: 'Alice', password: 'xxxx' }, 'auth_err')).msg.includes('đã có'), 'không cho trùng tên (không phân biệt hoa thường)');
    ok((await dup.req({ t: 'login', name: 'alice', password: 'sai' }, 'auth_err')).msg.includes('Sai'), 'từ chối sai mật khẩu');
    dup.close();

    // Kết bạn
    const inc = bob.wait('friends', m => m.incoming.some(p => p.name === 'alice'));
    alice.send({ t: 'friend_request', name: 'bob' });
    await inc;
    const fr = alice.wait('friends', m => m.friends.some(p => p.name === 'bob'));
    bob.send({ t: 'friend_respond', name: 'alice', accept: true });
    const af = await fr;
    ok(af.friends.find(p => p.name === 'bob').status === 'online', 'kết bạn & thấy trạng thái trực tuyến');

    // Thách đấu bạn bè (tính điểm) ×3 → chuỗi 3 thắng → Liên sát
    let lastOver;
    for (let i = 0; i < 3; i++) {
      const chIn = bob.wait('challenge_in');
      alice.send({ t: 'challenge', name: 'bob', variant: 'thuong', time: 10, inc: 0, rated: true });
      const ch = await chIn;
      const ra = alice.wait('room', m => m.room.game && m.room.game.status === 'playing' && m.room.game.moves.length === 0);
      const rb = bob.wait('room', m => m.room.game && m.room.game.status === 'playing' && m.room.game.moves.length === 0);
      bob.send({ t: 'challenge_respond', id: ch.ch.id, accept: true });
      const [A, B] = await Promise.all([ra, rb]);
      const red = A.room.you === 'r' ? alice : bob, black = red === alice ? bob : alice;
      // để alice luôn thắng: nếu alice cầm Đen thì cho Đỏ (bob) đi rồi alice... đơn giản: bên thua là bob
      const g = A.room.game;
      const mv = X.legalMoves(g.board, 'r', 'thuong')[0];
      await red.req({ t: 'move', from: mv.from, to: mv.to }, 'room', m => m.room.game.moves.length === 1);
      const over = alice.wait('game_over');
      bob.send({ t: 'resign' });
      lastOver = await over;
      const aliceSeat = A.room.you;
      assert.strictEqual(lastOver.result, aliceSeat);
      if (i === 0) {
        ok(lastOver.changes[aliceSeat].delta > 0, 'ván tính điểm: người thắng được cộng điểm (+' + lastOver.changes[aliceSeat].delta + ')');
        ok(B.room.you !== A.room.you, 'hai kỳ thủ khác màu');
      }
      await alice.req({ t: 'room_leave' }, 'room_left');
      await bob.req({ t: 'room_leave' }, 'room_left');
    }
    const aSeat = lastOver.you;
    ok(lastOver.changes[aSeat].newTitles.includes('lien_sat'), 'thắng 3 ván liên tiếp nhận danh hiệu "Liên sát"');
    const prof = await carol.req({ t: 'profile', name: 'alice' }, 'profile');
    ok(prof.profile.wins === 3 && prof.profile.streak === 3 && prof.profile.recent.length === 3, 'hồ sơ ghi nhận 3 thắng và lịch sử ván');
    const rec = await carol.req({ t: 'game_get', id: prof.profile.recent[0].id }, 'game_record');
    ok(rec.game.moves.length === 1 && rec.game.reason === 'resign', 'lưu biên bản ván để xem lại');
    const lb = await carol.req({ t: 'leaderboard' }, 'leaderboard');
    ok(lb.list[0].name === 'alice', 'bảng xếp hạng: alice đứng đầu');

    // Phòng cờ úp có trọng tài + người xem
    const created = await carol.req({ t: 'room_create', name: 'Giải nội bộ', variant: 'up', time: 5, inc: 2, rated: false, seat: 'spectator' }, 'room');
    const roomId = created.room.id;
    ok(created.room.you === 'spectator' && created.room.isOwner, 'tạo phòng, chủ phòng ngồi xem');
    await dave.req({ t: 'room_join', id: roomId, as: 'referee' }, 'room', m => m.room.you === 'referee');
    await alice.req({ t: 'room_join', id: roomId, as: 'r' }, 'room', m => m.room.you === 'r');
    await bob.req({ t: 'room_join', id: roomId, as: 'b' }, 'room', m => m.room.you === 'b');
    ok(true, 'trọng tài và 2 kỳ thủ vào phòng');
    alice.send({ t: 'room_ready', ready: true });
    const waitRef = await bob.req({ t: 'room_ready', ready: true }, 'room', m => m.room.ready.r && m.room.ready.b);
    ok(!waitRef.room.game, 'có trọng tài: chưa tự bắt đầu khi hai bên sẵn sàng');
    const started = carol.wait('room', m => m.room.game && m.room.game.status === 'playing');
    dave.send({ t: 'ref_start' });
    const st = await started;
    const pub = st.room.game.board;
    ok(pub.filter(p => p && p[1] === 'X').length === 30 && !JSON.stringify(st.room).includes('secret'), 'người xem không thấy danh tính quân úp');
    const hid = X.legalMoves(pub, 'r', 'up').find(m => pub[m.from][1] === 'X');
    const mvState = carol.wait('room', m => m.room.game && m.room.game.moves.length === 1);
    alice.send({ t: 'move', from: hid.from, to: hid.to });
    const s1 = await mvState;
    const piece = s1.room.game.board[hid.to];
    ok(piece.length === 2 && piece[0] === 'r' && s1.room.game.moves[0].rev === piece[1], 'quân úp lật mặt cho mọi người thấy sau khi đi');
    const illegal = bob.wait('error');
    bob.send({ t: 'move', from: X.sq(0, 4), to: X.sq(5, 4) });
    ok((await illegal).msg.length > 0, 'server từ chối nước đi sai luật');
    await dave.req({ t: 'ref_pause', pause: true }, 'room', m => m.room.game.paused);
    const pausedErr = bob.wait('error');
    const bm = X.legalMoves(s1.room.game.board, 'b', 'up')[0];
    bob.send({ t: 'move', from: bm.from, to: bm.to });
    ok((await pausedErr).msg.includes('tạm dừng'), 'trọng tài tạm dừng: không đi được');
    await dave.req({ t: 'ref_pause', pause: false }, 'room', m => !m.room.game.paused);
    const chatSeen = alice.wait('chat', m => m.msg.from === 'carol');
    carol.send({ t: 'chat', text: 'Ván hay quá!' });
    ok((await chatSeen).msg.role === 'spectator', 'người xem trò chuyện trong phòng');
    const refOver = alice.wait('game_over');
    dave.send({ t: 'ref_decide', result: 'draw', note: 'Thử nghiệm' });
    const ro = await refOver;
    ok(ro.result === 'draw' && ro.reason === 'referee' && !ro.rated, 'trọng tài phân xử hòa');
    const kicked = bob.wait('room_left');
    carol.send({ t: 'room_kick', name: 'bob' });
    ok(!!(await kicked).msg, 'chủ phòng mời người khác ra khỏi phòng');

    // Ghép trận ngẫu nhiên
    await alice.req({ t: 'room_leave' }, 'room_left');
    const ma = alice.wait('room', m => m.room.kind === 'match' && m.room.game && m.room.game.status === 'playing', 6000);
    const mb = bob.wait('room', m => m.room.kind === 'match' && m.room.game && m.room.game.status === 'playing', 6000);
    alice.send({ t: 'queue_join', variant: 'thuong' });
    bob.send({ t: 'queue_join', variant: 'thuong' });
    const [MA] = await Promise.all([ma, mb]);
    ok(MA.room.rated && MA.room.time === 10, 'ghép trận ngẫu nhiên tạo ván tính điểm 10 phút');

    // Mất kết nối & kết nối lại
    alice.close();
    await sleep(200);
    const alice2 = new Client(url);
    await alice2.opened;
    const back = alice2.wait('room', m => m.room.id === MA.room.id && m.room.game.status === 'playing');
    alice2.send({ t: 'hello', token: alice.token });
    ok(!!(await back), 'kết nối lại vẫn quay về đúng ván đang chơi');

    // Sai mật khẩu liên tục bị chặn tạm (đặt cuối vì chặn theo IP)
    const brute = new Client(url);
    await brute.opened;
    for (let i = 0; i < 10; i++) await brute.req({ t: 'login', name: 'alice', password: 'sai' + i }, 'auth_err');
    const locked = await brute.req({ t: 'login', name: 'alice', password: 'matkhau' }, 'auth_err');
    ok(locked.msg.includes('quá nhiều'), 'sai mật khẩu 10 lần thì bị chặn tạm');
    brute.close();
    alice2.close(); bob.close(); carol.close(); dave.close();
  } finally {
    srv.kill();
    await sleep(100);
    for (const f of [dataFile, dataFile + '.tmp']) try { fs.unlinkSync(f); } catch (e) { /* bỏ qua */ }
  }
}

(async () => {
  rulesTests();
  if (typeof WebSocket === 'undefined') console.log('(Bỏ qua kiểm thử trực tuyến: cần Node.js ≥ 22)');
  else await onlineTests();
  console.log('\nĐạt ' + passed + ' kiểm tra.');
  process.exit(0);
})().catch(e => { console.error('\n✗ THẤT BẠI:', e); process.exit(1); });
