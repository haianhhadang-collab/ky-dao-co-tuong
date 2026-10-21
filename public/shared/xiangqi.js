/*
 * Cờ Tướng – bộ luật dùng chung cho server (Node.js) và trình duyệt.
 *
 * Bàn cờ: mảng 90 ô, chỉ số = hàng * 9 + cột. Hàng 0 là phía Đen (trên), hàng 9 là phía Đỏ (dưới).
 * Quân: chuỗi màu ('r' đỏ | 'b' đen) + loại:
 *   K tướng, A sĩ, E tượng, H mã, R xe, C pháo, P tốt.
 * Quân úp (cờ úp): màu + 'X' + loại của vị trí xuất phát, ví dụ 'rXH' = quân đỏ úp nằm ở chỗ mã.
 * Quân úp đi theo luật của vị trí xuất phát, đi xong thì lật lên thành quân thật.
 * Danh tính quân úp chỉ nằm trong game.secret (chỉ server / máy cục bộ biết).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Xiangqi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLS = 9, ROWS = 10, SIZE = 90;
  const NAMES = { K: 'Tướng', A: 'Sĩ', E: 'Tượng', H: 'Mã', R: 'Xe', C: 'Pháo', P: 'Tốt' };
  const SHORT = { K: 'Tg', A: 'S', E: 'T', H: 'M', R: 'X', C: 'P', P: 'B' };
  const HAN = {
    r: { K: '帥', A: '仕', E: '相', H: '傌', R: '俥', C: '炮', P: '兵' },
    b: { K: '將', A: '士', E: '象', H: '馬', R: '車', C: '砲', P: '卒' }
  };
  const FULL_SET = { R: 2, H: 2, E: 2, A: 2, C: 2, P: 5 };
  const VARIANTS = { thuong: 'Cờ tướng', up: 'Cờ úp' };
  const REASONS = {
    checkmate: 'Chiếu bí',
    stalemate: 'Hết nước đi',
    perpetual_check: 'Chiếu dai phạm luật',
    repetition: 'Lặp lại thế cờ 3 lần',
    no_capture: '60 nước liền không ăn quân',
    material: 'Hai bên không đủ lực tấn công',
    resign: 'Đầu hàng',
    timeout: 'Hết giờ',
    agreement: 'Hai bên thỏa thuận hòa',
    referee: 'Trọng tài phân xử',
    abandon: 'Mất kết nối quá lâu',
    leave: 'Rời bàn khi đang chơi'
  };

  const sq = (r, c) => r * COLS + c;
  const rowOf = s => (s / COLS) | 0;
  const colOf = s => s % COLS;
  const inBoard = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const other = col => (col === 'r' ? 'b' : 'r');
  const isHidden = p => !!p && p[1] === 'X';
  const moveType = p => (p[1] === 'X' ? p[2] : p[1]);

  const BACK = ['R', 'H', 'E', 'A', 'K', 'A', 'E', 'H', 'R'];
  const START = new Array(SIZE).fill(null);
  for (let c = 0; c < 9; c++) { START[sq(0, c)] = 'b' + BACK[c]; START[sq(9, c)] = 'r' + BACK[c]; }
  START[sq(2, 1)] = START[sq(2, 7)] = 'bC';
  START[sq(7, 1)] = START[sq(7, 7)] = 'rC';
  for (let c = 0; c < 9; c += 2) { START[sq(3, c)] = 'bP'; START[sq(6, c)] = 'rP'; }

  /** Thế cờ xuất phát công khai: với cờ úp, mọi quân trừ tướng đều úp. */
  function startBoard(variant) {
    const b = START.slice();
    if (variant === 'up') for (let s = 0; s < SIZE; s++) if (b[s] && b[s][1] !== 'K') b[s] = b[s][0] + 'X' + b[s][1];
    return b;
  }

  const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  // [dr, dc, chân-mã dr, chân-mã dc]
  const HORSE = [[-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0],
    [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1]];

  const inPalace = (r, c, col) => c >= 3 && c <= 5 && (col === 'r' ? r >= 7 && r <= 9 : r >= 0 && r <= 2);
  const onOwnSide = (r, col) => (col === 'r' ? r >= 5 : r <= 4);

  /** Sinh nước đi giả hợp lệ (chưa xét tự chiếu) cho quân tại ô s. */
  function pseudoMoves(board, s, variant, out) {
    out = out || [];
    const p = board[s];
    if (!p) return out;
    const col = p[0], hidden = p[1] === 'X', t = hidden ? p[2] : p[1];
    const r = rowOf(s), c = colOf(s);
    // Cờ úp: sĩ/tượng đã lật được đi khắp bàn (tượng vẫn bị cản mắt).
    const free = variant === 'up' && !hidden;
    const add = (rr, cc) => {
      const d = sq(rr, cc), q = board[d];
      if (!q || q[0] !== col) out.push({ from: s, to: d });
    };
    switch (t) {
      case 'K':
        for (const [dr, dc] of ORTH) { const rr = r + dr, cc = c + dc; if (inPalace(rr, cc, col)) add(rr, cc); }
        break;
      case 'A':
        for (const [dr, dc] of DIAG) {
          const rr = r + dr, cc = c + dc;
          if (free ? inBoard(rr, cc) : inPalace(rr, cc, col)) add(rr, cc);
        }
        break;
      case 'E':
        for (const [dr, dc] of DIAG) {
          const rr = r + 2 * dr, cc = c + 2 * dc;
          if (!inBoard(rr, cc) || (!free && !onOwnSide(rr, col))) continue;
          if (board[sq(r + dr, c + dc)]) continue;
          add(rr, cc);
        }
        break;
      case 'H':
        for (const [dr, dc, lr, lc] of HORSE) {
          const rr = r + dr, cc = c + dc;
          if (!inBoard(rr, cc) || board[sq(r + lr, c + lc)]) continue;
          add(rr, cc);
        }
        break;
      case 'R':
        for (const [dr, dc] of ORTH) {
          let rr = r + dr, cc = c + dc;
          while (inBoard(rr, cc)) {
            const q = board[sq(rr, cc)];
            if (q) { if (q[0] !== col) out.push({ from: s, to: sq(rr, cc) }); break; }
            out.push({ from: s, to: sq(rr, cc) });
            rr += dr; cc += dc;
          }
        }
        break;
      case 'C':
        for (const [dr, dc] of ORTH) {
          let rr = r + dr, cc = c + dc, screen = false;
          while (inBoard(rr, cc)) {
            const q = board[sq(rr, cc)];
            if (!screen) {
              if (q) screen = true; else out.push({ from: s, to: sq(rr, cc) });
            } else if (q) {
              if (q[0] !== col) out.push({ from: s, to: sq(rr, cc) });
              break;
            }
            rr += dr; cc += dc;
          }
        }
        break;
      case 'P': {
        const f = col === 'r' ? -1 : 1;
        if (inBoard(r + f, c)) add(r + f, c);
        if (!onOwnSide(r, col)) { if (c > 0) add(r, c - 1); if (c < 8) add(r, c + 1); }
        break;
      }
    }
    return out;
  }

  function findKing(board, col) {
    const k = col + 'K';
    for (let s = 0; s < SIZE; s++) if (board[s] === k) return s;
    return -1;
  }

  /** Bên col có đang bị chiếu không (kể cả lộ mặt tướng). */
  function inCheck(board, col, variant) {
    const k = findKing(board, col);
    if (k < 0) return true;
    const ek = findKing(board, other(col));
    if (ek >= 0 && colOf(ek) === colOf(k)) {
      const step = ek > k ? COLS : -COLS;
      let blocked = false;
      for (let s = k + step; s !== ek; s += step) if (board[s]) { blocked = true; break; }
      if (!blocked) return true;
    }
    const opp = other(col), buf = [];
    for (let s = 0; s < SIZE; s++) {
      const p = board[s];
      if (!p || p[0] !== opp || p[1] === 'K') continue;
      buf.length = 0;
      pseudoMoves(board, s, variant, buf);
      for (let i = 0; i < buf.length; i++) if (buf[i].to === k) return true;
    }
    return false;
  }

  function isSafe(board, m, col, variant) {
    const b = board.slice();
    b[m.to] = b[m.from];
    b[m.from] = null;
    return !inCheck(b, col, variant);
  }

  function legalMovesFrom(board, s, variant) {
    const p = board[s];
    if (!p) return [];
    return pseudoMoves(board, s, variant, []).filter(m => isSafe(board, m, p[0], variant));
  }

  function legalMoves(board, col, variant) {
    const res = [], buf = [];
    for (let s = 0; s < SIZE; s++) {
      const p = board[s];
      if (!p || p[0] !== col) continue;
      buf.length = 0;
      pseudoMoves(board, s, variant, buf);
      for (const m of buf) if (isSafe(board, m, col, variant)) res.push(m);
    }
    return res;
  }

  function hasLegalMove(board, col, variant) {
    const buf = [];
    for (let s = 0; s < SIZE; s++) {
      const p = board[s];
      if (!p || p[0] !== col) continue;
      buf.length = 0;
      pseudoMoves(board, s, variant, buf);
      for (const m of buf) if (isSafe(board, m, col, variant)) return true;
    }
    return false;
  }

  const positionKey = (board, turn) => board.map(p => p || '-').join('') + turn;

  /** Ký hiệu nước đi kiểu Việt Nam: X2.5 (tiến), M8/7 (thoái), P2-5 (bình). */
  function moveNotation(board, from, to) {
    const p = board[from];
    if (!p) return '?';
    const col = p[0], t = moveType(p);
    const fr = rowOf(from), fc = colOf(from), tr = rowOf(to), tc = colOf(to);
    const file = c => (col === 'r' ? 9 - c : c + 1);
    let head = SHORT[t] + file(fc);
    const same = [];
    for (let r = 0; r < ROWS; r++) {
      const q = board[sq(r, fc)];
      if (q && q[0] === col && moveType(q) === t) same.push(r);
    }
    if (same.length >= 2) {
      same.sort((a, b) => (col === 'r' ? a - b : b - a)); // quân trước (gần địch) đứng đầu
      const i = same.indexOf(fr);
      const tag = i === 0 ? 't' : i === same.length - 1 ? 's' : 'g';
      head = SHORT[t] + tag;
    }
    if (fr === tr) return head + '-' + file(tc);
    const forward = col === 'r' ? fr > tr : tr > fr;
    const diagonal = t === 'H' || t === 'A' || t === 'E';
    return head + (forward ? '.' : '/') + (diagonal ? file(tc) : Math.abs(fr - tr));
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Tạo ván mới. variant: 'thuong' | 'up'. */
  function createGame(variant, rng) {
    variant = variant === 'up' ? 'up' : 'thuong';
    rng = rng || Math.random;
    const board = START.slice();
    const secret = {};
    if (variant === 'up') {
      for (const col of ['r', 'b']) {
        const squares = [], types = [];
        for (let s = 0; s < SIZE; s++) {
          const p = board[s];
          if (p && p[0] === col && p[1] !== 'K') { squares.push(s); types.push(p[1]); }
        }
        shuffle(types, rng);
        squares.forEach((s, i) => { secret[s] = types[i]; board[s] = col + 'X' + board[s][1]; });
      }
    }
    return {
      variant, board, turn: 'r', secret,
      moves: [], captured: { r: [], b: [] },
      keys: [positionKey(board, 'r')], noCapture: 0,
      status: 'playing', result: null, reason: null,
      snapshots: []
    };
  }

  function snapshot(g) {
    return {
      board: g.board.slice(), turn: g.turn, secret: Object.assign({}, g.secret),
      captured: { r: g.captured.r.slice(), b: g.captured.b.slice() },
      noCapture: g.noCapture, moves: g.moves.length, keys: g.keys.length
    };
  }

  function endGame(g, result, reason) {
    g.status = 'ended';
    g.result = result;
    g.reason = reason;
  }

  function hasAttackers(board, variant) {
    for (const p of board) {
      if (!p) continue;
      const t = p[1];
      if (t === 'K') continue;
      if (variant === 'up') return true; // cờ úp: sĩ/tượng lật lên cũng qua sông được
      if (t !== 'A' && t !== 'E') return true;
    }
    return false;
  }

  /** Kiểm tra kết thúc sau mỗi nước. */
  function evaluateEnd(g) {
    const side = g.turn;
    if (!hasLegalMove(g.board, side, g.variant)) {
      endGame(g, other(side), inCheck(g.board, side, g.variant) ? 'checkmate' : 'stalemate');
      return;
    }
    const key = g.keys[g.keys.length - 1];
    const idx = [];
    for (let i = 0; i < g.keys.length; i++) if (g.keys[i] === key) idx.push(i);
    if (idx.length >= 3) {
      const seg = g.moves.slice(idx[idx.length - 3]);
      const allCheck = { r: true, b: true }, moved = { r: false, b: false };
      for (const m of seg) { moved[m.color] = true; if (!m.check) allCheck[m.color] = false; }
      const rc = allCheck.r && moved.r, bc = allCheck.b && moved.b;
      if (rc && !bc) endGame(g, 'b', 'perpetual_check');
      else if (bc && !rc) endGame(g, 'r', 'perpetual_check');
      else endGame(g, 'draw', 'repetition');
      return;
    }
    if (g.noCapture >= 120) { endGame(g, 'draw', 'no_capture'); return; }
    if (!hasAttackers(g.board, g.variant)) endGame(g, 'draw', 'material');
  }

  /** Thực hiện nước đi (có kiểm tra hợp lệ). Trả về { ok, move } hoặc { ok:false, error }. */
  function makeMove(g, from, to) {
    if (g.status !== 'playing') return { ok: false, error: 'Ván cờ đã kết thúc' };
    if (!(from >= 0 && from < SIZE && to >= 0 && to < SIZE)) return { ok: false, error: 'Ô không hợp lệ' };
    const p = g.board[from];
    if (!p || p[0] !== g.turn) return { ok: false, error: 'Không phải quân của bạn' };
    if (!legalMovesFrom(g.board, from, g.variant).some(m => m.to === to)) return { ok: false, error: 'Nước đi không hợp lệ' };

    g.snapshots.push(snapshot(g));
    const col = g.turn, opp = other(col);
    const n = moveNotation(g.board, from, to);
    const target = g.board[to];
    let cap = null, capH = false;
    if (target) {
      if (target[1] === 'X') { cap = g.secret[to] || target[2]; capH = true; delete g.secret[to]; }
      else cap = target[1];
      g.captured[opp].push(cap);
    }
    let piece = p, rev = null;
    if (p[1] === 'X') { rev = g.secret[from] || p[2]; delete g.secret[from]; piece = col + rev; }
    g.board[to] = piece;
    g.board[from] = null;
    g.turn = opp;
    g.noCapture = cap ? 0 : g.noCapture + 1;
    const check = inCheck(g.board, opp, g.variant);
    const move = { from, to, color: col, n, rev, cap, capH, check };
    g.moves.push(move);
    g.keys.push(positionKey(g.board, g.turn));
    evaluateEnd(g);
    return { ok: true, move };
  }

  /** Lùi lại `plies` nửa nước. */
  function undo(g, plies) {
    plies = plies || 1;
    if (plies > g.snapshots.length) return false;
    const snap = g.snapshots[g.snapshots.length - plies];
    g.snapshots.length -= plies;
    g.board = snap.board;
    g.turn = snap.turn;
    g.secret = snap.secret;
    g.captured = snap.captured;
    g.noCapture = snap.noCapture;
    g.moves.length = snap.moves;
    g.keys.length = snap.keys;
    g.status = 'playing';
    g.result = null;
    g.reason = null;
    return true;
  }

  /** Áp một nước đã ghi (dữ liệu công khai) lên bàn cờ công khai – dùng cho xem lại ván. */
  function applyPublicMove(board, m) {
    const p = board[m.from];
    if (!p) return board;
    board[m.to] = m.rev ? p[0] + m.rev : p;
    board[m.from] = null;
    return board;
  }

  /** Số quân úp còn lại theo loại của mỗi bên (suy ra từ các nước đã lật/ăn). */
  function hiddenPool(moves) {
    const pool = { r: Object.assign({}, FULL_SET), b: Object.assign({}, FULL_SET) };
    for (const m of moves) {
      if (m.rev) pool[m.color][m.rev]--;
      if (m.capH && m.cap) pool[other(m.color)][m.cap]--;
    }
    return pool;
  }

  function publicState(g) {
    return {
      variant: g.variant, board: g.board.slice(), turn: g.turn,
      moves: g.moves.map(m => ({ from: m.from, to: m.to, color: m.color, n: m.n, rev: m.rev, cap: m.cap, capH: m.capH, check: m.check })),
      captured: { r: g.captured.r.slice(), b: g.captured.b.slice() },
      status: g.status, result: g.result, reason: g.reason,
      check: g.status === 'playing' && inCheck(g.board, g.turn, g.variant)
    };
  }

  return {
    COLS, ROWS, SIZE, NAMES, SHORT, HAN, FULL_SET, VARIANTS, REASONS, START,
    sq, rowOf, colOf, other, isHidden, moveType, startBoard,
    pseudoMoves, legalMoves, legalMovesFrom, hasLegalMove, inCheck, findKing,
    createGame, makeMove, undo, moveNotation, positionKey, publicState,
    applyPublicMove, hiddenPool
  };
});
