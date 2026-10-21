/*
 * Máy chơi cờ tướng / cờ úp: negamax alpha-beta, tìm kiếm tĩnh (quiescence), bảng chuyển vị,
 * nước sát thủ (killer) và lịch sử. Chạy trong Web Worker (hoặc luồng chính nếu không có Worker).
 * Với cờ úp, máy KHÔNG biết danh tính quân úp: quân úp được định giá bằng giá trị trung bình
 * của các quân còn úp, đúng như thông tin một người chơi thật có được.
 */
(function (root) {
  'use strict';

  const K = 1, A = 2, E = 3, H = 4, R = 5, C = 6, P = 7;
  const BLACK = 8, HIDDEN = 16, UNKNOWN = 32;
  const TYPE = { K, A, E, H, R, C, P };
  const VAL = [0, 0, 200, 200, 400, 900, 450, 100];
  const MATE = 30000, INF = 32000;

  // Bảng điểm vị trí (góc nhìn quân Đỏ, hàng 0 = phía Đen).
  const PST = [];
  PST[K] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, -9, -12, -9, 0, 0, 0,
    0, 0, 0, -4, -6, -4, 0, 0, 0,
    0, 0, 0, 2, 8, 2, 0, 0, 0
  ];
  PST[A] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 6, 0, 0, 0, 0,
    0, 0, 0, 2, 0, 2, 0, 0, 0
  ];
  PST[E] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, -2, 0, 0, 0, -2, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    -2, 0, 0, 0, 6, 0, 0, 0, -2,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 2, 0, 0, 0, 2, 0, 0
  ];
  PST[H] = [
    4, 8, 16, 12, 4, 12, 16, 8, 4,
    4, 10, 28, 16, 8, 16, 28, 10, 4,
    12, 14, 16, 20, 18, 20, 16, 14, 12,
    8, 24, 18, 24, 20, 24, 18, 24, 8,
    6, 16, 14, 18, 16, 18, 14, 16, 6,
    4, 12, 16, 14, 12, 14, 16, 12, 4,
    2, 6, 8, 6, 10, 6, 8, 6, 2,
    4, 2, 8, 8, 4, 8, 8, 2, 4,
    0, 2, 4, 4, -2, 4, 4, 2, 0,
    0, -4, 0, 0, 0, 0, 0, -4, 0
  ];
  PST[R] = [
    14, 14, 12, 18, 16, 18, 12, 14, 14,
    16, 20, 18, 24, 26, 24, 18, 20, 16,
    12, 12, 12, 18, 18, 18, 12, 12, 12,
    12, 18, 16, 22, 22, 22, 16, 18, 12,
    12, 14, 12, 18, 18, 18, 12, 14, 12,
    12, 16, 14, 20, 20, 20, 14, 16, 12,
    6, 10, 8, 14, 14, 14, 8, 10, 6,
    4, 8, 6, 14, 12, 14, 6, 8, 4,
    8, 4, 8, 16, 8, 16, 8, 4, 8,
    -2, 10, 6, 14, 12, 14, 6, 10, -2
  ];
  PST[C] = [
    6, 4, 0, -10, -12, -10, 0, 4, 6,
    2, 2, 0, -4, -14, -4, 0, 2, 2,
    2, 2, 0, -10, -8, -10, 0, 2, 2,
    0, 0, -2, 4, 10, 4, -2, 0, 0,
    0, 0, 0, 2, 8, 2, 0, 0, 0,
    -2, 0, 4, 2, 6, 2, 4, 0, -2,
    0, 0, 0, 2, 4, 2, 0, 0, 0,
    4, 0, 8, 6, 10, 6, 8, 0, 4,
    0, 2, 4, 6, 6, 6, 4, 2, 0,
    0, 0, 2, 6, 6, 6, 2, 0, 0
  ];
  PST[P] = [
    0, 3, 6, 9, 12, 9, 6, 3, 0,
    18, 36, 56, 80, 120, 80, 56, 36, 18,
    14, 26, 42, 60, 80, 60, 42, 26, 14,
    10, 20, 30, 34, 40, 34, 30, 20, 10,
    6, 12, 18, 18, 20, 18, 18, 12, 6,
    2, 0, 8, 0, 8, 0, 8, 0, 2,
    0, 0, -2, 0, 4, 0, -2, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0
  ];
  PST[0] = new Array(90).fill(0);
  for (let t = 1; t <= 7; t++) if (PST[t].length !== 90) throw new Error('PST ' + t);

  const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const HORSE = [[-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0],
    [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1]];

  // Zobrist
  let seed = 0x2545f491;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const ZK = new Int32Array(64 * 90), ZL = new Int32Array(64 * 90);
  for (let i = 0; i < ZK.length; i++) { ZK[i] = rnd(); ZL[i] = rnd(); }
  const ZSIDE = rnd(), ZSIDE_L = rnd();

  const TT_BITS = 19, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const ttKey = new Int32Array(TT_SIZE), ttLock = new Int32Array(TT_SIZE);
  const ttDepth = new Int8Array(TT_SIZE), ttFlag = new Int8Array(TT_SIZE);
  const ttScore = new Int16Array(TT_SIZE), ttMove = new Int32Array(TT_SIZE);

  // Trạng thái tìm kiếm
  const board = new Int32Array(90);
  let side = 0, upVariant = false, hashK = 0, hashL = 0;
  let avgVal = [300, 300];
  let nodes = 0, deadline = 0, stopped = false;
  const killers = [];
  const history = new Int32Array(90 * 90);
  const BUF = [];
  for (let i = 0; i < 160; i++) BUF.push(new Int32Array(256));
  const pathK = [], pathL = [];
  let gameHashes = new Set();

  const inB = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9;
  const inPalace = (r, c, black) => c >= 3 && c <= 5 && (black ? r >= 0 && r <= 2 : r >= 7 && r <= 9);
  const ownSide = (r, black) => (black ? r <= 4 : r >= 5);

  function zIndex(p) { return p & 63; }

  function pieceValue(p) {
    const t = p & 7;
    if (p & (HIDDEN | UNKNOWN)) return avgVal[(p & BLACK) ? 1 : 0];
    return VAL[t];
  }

  function evaluate() {
    let s = 0;
    for (let i = 0; i < 90; i++) {
      const p = board[i];
      if (!p) continue;
      const t = p & 7, black = p & BLACK;
      let v;
      if (p & HIDDEN) v = avgVal[black ? 1 : 0];
      else if (p & UNKNOWN) v = avgVal[black ? 1 : 0] + 8;
      else {
        const idx = black ? (9 - ((i / 9) | 0)) * 9 + (i % 9) : i;
        v = VAL[t] + PST[t][idx];
      }
      s += black ? -v : v;
    }
    return side ? -s : s;
  }

  // biến dùng chung cho genMoves (tránh tạo closure ở mỗi nút)
  let gOut = null, gN = 0, gMe = 0, gCaps = false, gS = 0;
  function add(rr, cc) {
    const d = rr * 9 + cc, q = board[d];
    if (q) { if ((q & BLACK) !== gMe) gOut[gN++] = (gS << 7) | d; }
    else if (!gCaps) gOut[gN++] = (gS << 7) | d;
  }

  function genMoves(sd, capsOnly, out) {
    const me = sd ? BLACK : 0;
    gOut = out; gN = 0; gMe = me; gCaps = capsOnly;
    for (let s = 0; s < 90; s++) {
      const p = board[s];
      if (!p || (p & BLACK) !== me) continue;
      gS = s;
      const t = p & 7, r = (s / 9) | 0, c = s % 9, black = !!me;
      const free = upVariant && !(p & HIDDEN);
      switch (t) {
        case K:
          for (const [dr, dc] of ORTH) { const rr = r + dr, cc = c + dc; if (inPalace(rr, cc, black)) add(rr, cc); }
          break;
        case A:
          for (const [dr, dc] of DIAG) { const rr = r + dr, cc = c + dc; if (free ? inB(rr, cc) : inPalace(rr, cc, black)) add(rr, cc); }
          break;
        case E:
          for (const [dr, dc] of DIAG) {
            const rr = r + 2 * dr, cc = c + 2 * dc;
            if (!inB(rr, cc) || (!free && !ownSide(rr, black)) || board[(r + dr) * 9 + c + dc]) continue;
            add(rr, cc);
          }
          break;
        case H:
          for (const [dr, dc, lr, lc] of HORSE) {
            const rr = r + dr, cc = c + dc;
            if (!inB(rr, cc) || board[(r + lr) * 9 + c + lc]) continue;
            add(rr, cc);
          }
          break;
        case R:
          for (const [dr, dc] of ORTH) {
            let rr = r + dr, cc = c + dc;
            while (inB(rr, cc)) {
              const q = board[rr * 9 + cc];
              if (q) { if ((q & BLACK) !== me) gOut[gN++] = (s << 7) | (rr * 9 + cc); break; }
              if (!capsOnly) gOut[gN++] = (s << 7) | (rr * 9 + cc);
              rr += dr; cc += dc;
            }
          }
          break;
        case C:
          for (const [dr, dc] of ORTH) {
            let rr = r + dr, cc = c + dc, screen = false;
            while (inB(rr, cc)) {
              const q = board[rr * 9 + cc];
              if (!screen) { if (q) screen = true; else if (!capsOnly) gOut[gN++] = (s << 7) | (rr * 9 + cc); }
              else if (q) { if ((q & BLACK) !== me) gOut[gN++] = (s << 7) | (rr * 9 + cc); break; }
              rr += dr; cc += dc;
            }
          }
          break;
        case P: {
          const f = black ? 1 : -1;
          if (inB(r + f, c)) add(r + f, c);
          if (!ownSide(r, black)) { if (c > 0) add(r, c - 1); if (c < 8) add(r, c + 1); }
          break;
        }
      }
    }
    return gN;
  }

  function kingSq(sd) {
    const code = K | (sd ? BLACK : 0);
    for (let i = 0; i < 90; i++) if (board[i] === code) return i;
    return -1;
  }

  /** Ô sq có bị bên `by` (0 đỏ, 1 đen) tấn công không. */
  function attacked(sq, by) {
    const bb = by ? BLACK : 0;
    const r = (sq / 9) | 0, c = sq % 9;
    for (const [dr, dc] of ORTH) {
      let rr = r + dr, cc = c + dc, screen = false;
      while (inB(rr, cc)) {
        const p = board[rr * 9 + cc];
        if (p) {
          if (!screen) {
            if ((p & BLACK) === bb) {
              const t = p & 7;
              if (t === R || (t === K && dc === 0)) return true;
            }
            screen = true;
          } else {
            if ((p & BLACK) === bb && (p & 7) === C) return true;
            break;
          }
        }
        rr += dr; cc += dc;
      }
    }
    for (const [dr, dc, lr, lc] of HORSE) {
      const hr = r - dr, hc = c - dc;
      if (!inB(hr, hc)) continue;
      const p = board[hr * 9 + hc];
      if (!p || (p & BLACK) !== bb || (p & 7) !== H) continue;
      if (!board[(hr + lr) * 9 + hc + lc]) return true;
    }
    const f = by ? 1 : -1;
    if (inB(r - f, c)) { const p = board[(r - f) * 9 + c]; if (p && (p & BLACK) === bb && (p & 7) === P) return true; }
    if (by ? r >= 5 : r <= 4) {
      for (const dc of [-1, 1]) {
        if (!inB(r, c + dc)) continue;
        const p = board[r * 9 + c + dc];
        if (p && (p & BLACK) === bb && (p & 7) === P) return true;
      }
    }
    if (upVariant) {
      for (const [dr, dc] of DIAG) {
        if (inB(r + dr, c + dc)) { const p = board[(r + dr) * 9 + c + dc]; if (p && (p & BLACK) === bb && (p & 7) === A) return true; }
        if (inB(r + 2 * dr, c + 2 * dc) && !board[(r + dr) * 9 + c + dc]) {
          const p = board[(r + 2 * dr) * 9 + c + 2 * dc];
          if (p && (p & BLACK) === bb && (p & 7) === E) return true;
        }
      }
    }
    return false;
  }

  function inCheck(sd) {
    const k = kingSq(sd);
    return k < 0 || attacked(k, sd ^ 1);
  }

  const undoStack = [];
  function make(m) {
    const f = m >> 7, t = m & 127;
    const p = board[f], cap = board[t];
    undoStack.push(p, cap);
    let np = p;
    if (p & HIDDEN) np = (p & ~HIDDEN) | UNKNOWN;
    hashK ^= ZK[zIndex(p) * 90 + f] ^ ZK[zIndex(np) * 90 + t];
    hashL ^= ZL[zIndex(p) * 90 + f] ^ ZL[zIndex(np) * 90 + t];
    if (cap) { hashK ^= ZK[zIndex(cap) * 90 + t]; hashL ^= ZL[zIndex(cap) * 90 + t]; }
    board[t] = np;
    board[f] = 0;
    side ^= 1;
    hashK ^= ZSIDE; hashL ^= ZSIDE_L;
    return cap;
  }
  function unmake(m) {
    const f = m >> 7, t = m & 127;
    const cap = undoStack.pop(), p = undoStack.pop();
    const np = board[t];
    side ^= 1;
    hashK ^= ZSIDE; hashL ^= ZSIDE_L;
    hashK ^= ZK[zIndex(p) * 90 + f] ^ ZK[zIndex(np) * 90 + t];
    hashL ^= ZL[zIndex(p) * 90 + f] ^ ZL[zIndex(np) * 90 + t];
    if (cap) { hashK ^= ZK[zIndex(cap) * 90 + t]; hashL ^= ZL[zIndex(cap) * 90 + t]; }
    board[f] = p;
    board[t] = cap;
  }

  function computeHash() {
    let k = 0, l = 0;
    for (let i = 0; i < 90; i++) if (board[i]) { k ^= ZK[zIndex(board[i]) * 90 + i]; l ^= ZL[zIndex(board[i]) * 90 + i]; }
    if (side) { k ^= ZSIDE; l ^= ZSIDE_L; }
    hashK = k; hashL = l;
  }

  function mvvLva(m) {
    const cap = board[m & 127];
    if (!cap) return 0;
    return pieceValue(cap) * 10 - pieceValue(board[m >> 7]) / 10 + 100000;
  }

  function orderMoves(moves, n, ttm, ply) {
    const scores = new Array(n);
    const k1 = killers[ply * 2], k2 = killers[ply * 2 + 1];
    for (let i = 0; i < n; i++) {
      const m = moves[i];
      let sc;
      if (m === ttm) sc = 1e9;
      else if (board[m & 127]) sc = mvvLva(m);
      else if (m === k1) sc = 90000;
      else if (m === k2) sc = 80000;
      else sc = history[(m >> 7) * 90 + (m & 127)];
      scores[i] = sc;
    }
    // sắp xếp chèn (n nhỏ)
    for (let i = 1; i < n; i++) {
      const m = moves[i], s = scores[i];
      let j = i - 1;
      while (j >= 0 && scores[j] < s) { moves[j + 1] = moves[j]; scores[j + 1] = scores[j]; j--; }
      moves[j + 1] = m; scores[j + 1] = s;
    }
  }

  function timeUp() {
    if ((nodes & 2047) === 0 && Date.now() > deadline) stopped = true;
    return stopped;
  }

  function quiesce(alpha, beta, ply) {
    nodes++;
    if (timeUp()) return 0;
    const stand = evaluate();
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply > 120) return stand;
    const moves = BUF[ply];
    const n = genMoves(side, true, moves);
    orderMoves(moves, n, 0, Math.min(ply, 63));
    for (let i = 0; i < n; i++) {
      const m = moves[i];
      make(m);
      if (inCheck(side ^ 1)) { unmake(m); continue; }
      const sc = -quiesce(-beta, -alpha, ply + 1);
      unmake(m);
      if (stopped) return 0;
      if (sc >= beta) return sc;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  }

  function ttProbe() {
    const i = hashK & TT_MASK;
    if (ttKey[i] === hashK && ttLock[i] === hashL) return i;
    return -1;
  }
  function ttStore(depth, flag, score, move) {
    const i = hashK & TT_MASK;
    if (ttKey[i] === hashK && ttLock[i] === hashL && ttDepth[i] > depth && move === 0) return;
    ttKey[i] = hashK; ttLock[i] = hashL; ttDepth[i] = depth; ttFlag[i] = flag;
    ttScore[i] = Math.max(-INF, Math.min(INF, score)); ttMove[i] = move;
  }

  function search(depth, alpha, beta, ply) {
    if (ply > 0) {
      const key = hashK + ':' + hashL;
      if (gameHashes.has(key)) return 0;
      for (let i = pathK.length - 2; i >= 0; i -= 2) if (pathK[i] === hashK && pathL[i] === hashL) return 0;
    }
    const checked = inCheck(side);
    if (checked) depth++;
    if (depth <= 0) return quiesce(alpha, beta, ply);
    nodes++;
    if (timeUp()) return 0;

    let ttm = 0;
    const ti = ttProbe();
    if (ti >= 0) {
      ttm = ttMove[ti];
      if (ply > 0 && ttDepth[ti] >= depth) {
        const sc = ttScore[ti], fl = ttFlag[ti];
        if (fl === 0 || (fl === 1 && sc >= beta) || (fl === 2 && sc <= alpha)) return sc;
      }
    }

    // nước trống (null move) để cắt tỉa nhanh
    if (!checked && depth >= 3 && ply > 0 && beta < MATE - 100) {
      side ^= 1; hashK ^= ZSIDE; hashL ^= ZSIDE_L;
      const sc = -search(depth - 3, -beta, -beta + 1, ply + 1);
      side ^= 1; hashK ^= ZSIDE; hashL ^= ZSIDE_L;
      if (stopped) return 0;
      if (sc >= beta) return sc;
    }

    const moves = BUF[ply];
    const n = genMoves(side, false, moves);
    orderMoves(moves, n, ttm, Math.min(ply, 63));
    let best = -INF, bestMove = 0, legal = 0;
    const alpha0 = alpha;
    pathK.push(hashK); pathL.push(hashL);
    for (let i = 0; i < n; i++) {
      const m = moves[i];
      make(m);
      if (inCheck(side ^ 1)) { unmake(m); continue; }
      legal++;
      let sc;
      if (legal === 1) sc = -search(depth - 1, -beta, -alpha, ply + 1);
      else {
        const reduce = depth >= 3 && legal > 4 && !checked && !undoStack[undoStack.length - 1] ? 1 : 0;
        sc = -search(depth - 1 - reduce, -alpha - 1, -alpha, ply + 1);
        if (sc > alpha && !stopped) sc = -search(depth - 1, -beta, -alpha, ply + 1);
      }
      unmake(m);
      if (stopped) { pathK.pop(); pathL.pop(); return 0; }
      if (sc > best) { best = sc; bestMove = m; }
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) {
        if (!board[m & 127]) {
          const kp = Math.min(ply, 63) * 2;
          if (killers[kp] !== m) { killers[kp + 1] = killers[kp]; killers[kp] = m; }
          history[(m >> 7) * 90 + (m & 127)] += depth * depth;
        }
        break;
      }
    }
    pathK.pop(); pathL.pop();
    if (legal === 0) return -MATE + ply; // bí hoặc hết nước đều thua
    ttStore(depth, best >= beta ? 1 : best <= alpha0 ? 2 : 0, best, bestMove);
    return best;
  }

  function load(data) {
    upVariant = data.variant === 'up';
    for (let i = 0; i < 90; i++) {
      const s = data.board[i];
      if (!s) { board[i] = 0; continue; }
      let code = s[0] === 'b' ? BLACK : 0;
      if (s[1] === 'X') code |= TYPE[s[2]] | HIDDEN;
      else code |= TYPE[s[1]];
      board[i] = code;
    }
    side = data.turn === 'b' ? 1 : 0;
    avgVal = [data.avg && data.avg.r || 300, data.avg && data.avg.b || 300];
    computeHash();
  }

  const LEVELS = {
    1: { depth: 2, time: 400, noise: 140 },
    2: { depth: 4, time: 900, noise: 35 },
    3: { depth: 8, time: 2200, noise: 0 },
    4: { depth: 14, time: 5000, noise: 0 }
  };

  /** Tìm nước đi. data: { board, turn, variant, level, avg:{r,b}, history:[thế cờ dạng chuỗi], plies } */
  function think(data) {
    const lv = LEVELS[data.level] || LEVELS[2];
    gameHashes = new Set();
    if (Array.isArray(data.history)) {
      for (const hb of data.history) { load({ board: hb.board, turn: hb.turn, variant: data.variant, avg: data.avg }); gameHashes.add(hashK + ':' + hashL); }
    }
    load(data);
    killers.length = 0;
    history.fill(0);
    pathK.length = 0; pathL.length = 0;
    undoStack.length = 0;
    nodes = 0; stopped = false;
    const start = Date.now();
    deadline = start + (data.time || lv.time);

    const moves = new Int32Array(256);
    const n = genMoves(side, false, moves);
    const legal = [];
    for (let i = 0; i < n; i++) {
      make(moves[i]);
      if (!inCheck(side ^ 1)) legal.push(moves[i]);
      unmake(moves[i]);
    }
    if (!legal.length) return { from: -1, to: -1, score: -MATE, depth: 0 };
    if (legal.length === 1) return { from: legal[0] >> 7, to: legal[0] & 127, score: 0, depth: 0 };

    // Sổ khai cuộc nhỏ cho cờ tướng thường (2 nửa nước đầu)
    if (!upVariant && (data.plies || 0) <= 1 && data.level >= 2) {
      let book;
      if (side === 0) book = [[70, 67], [64, 67], [88, 69], [82, 65], [87, 67], [56, 47], [60, 51]];
      else if (data.board[67] === 'rC') book = [[1, 20], [7, 24]];
      else book = [[1, 20], [7, 24], [19, 22], [25, 22], [29, 38], [33, 42]];
      const ok = book.map(([f, t]) => (f << 7) | t).filter(m => legal.includes(m));
      if (ok.length) {
        const m = ok[Math.floor(Math.random() * ok.length)];
        return { from: m >> 7, to: m & 127, score: 0, depth: 0, book: true };
      }
    }

    const noise = lv.noise + ((data.plies || 0) < 6 ? 12 : 0);
    let bestMove = legal[0], bestScore = -INF, doneDepth = 0;
    let order = legal.slice();
    for (let d = 1; d <= lv.depth; d++) {
      const scored = [];
      let alpha = -INF, curBest = 0, curScore = -INF;
      for (const m of order) {
        make(m);
        const sc = noise > 0 ? -search(d - 1, -INF, INF, 1) : -search(d - 1, -INF, -alpha, 1);
        unmake(m);
        if (stopped) break;
        scored.push([m, sc]);
        if (sc > curScore) { curScore = sc; curBest = m; }
        if (sc > alpha) alpha = sc;
      }
      if (stopped && !scored.length) break;
      if (!stopped || curScore > bestScore) {
        if (noise > 0 && scored.length === order.length) {
          let pickScore = -INF;
          for (const [m, sc] of scored) {
            const v = sc + (Math.abs(sc) > MATE - 200 ? 0 : (Math.random() * 2 - 1) * noise);
            if (v > pickScore) { pickScore = v; curBest = m; }
          }
        }
        bestMove = curBest;
        bestScore = curScore;
        doneDepth = d;
      }
      if (stopped) break;
      scored.sort((a, b) => b[1] - a[1]);
      order = scored.map(x => x[0]);
      if (Math.abs(curScore) > MATE - 100) break;
      if (Date.now() - start > (deadline - start) * 0.55) break;
    }
    return { from: bestMove >> 7, to: bestMove & 127, score: bestScore, depth: doneDepth, nodes, ms: Date.now() - start };
  }

  const api = { think };
  if (typeof window === 'undefined' && typeof importScripts === 'function') {
    self.onmessage = e => {
      const res = think(e.data);
      res.id = e.data.id;
      self.postMessage(res);
    };
  } else {
    root.XqAI = api;
  }
})(typeof self !== 'undefined' ? self : this);
