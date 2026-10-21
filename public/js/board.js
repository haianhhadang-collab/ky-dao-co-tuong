/* Thành phần bàn cờ: vẽ lưới, quân cờ, đánh dấu nước đi, chọn & kéo-thả quân. */
(function () {
  'use strict';
  const X = window.Xiangqi;

  function gridSVG() {
    let s = '<svg class="xq-grid" viewBox="0 0 900 1000" preserveAspectRatio="none" aria-hidden="true">';
    s += '<rect class="g-border" x="50" y="50" width="800" height="900"/>';
    for (let i = 1; i < 9; i++) s += '<line x1="50" y1="' + (50 + i * 100) + '" x2="850" y2="' + (50 + i * 100) + '"/>';
    for (let j = 1; j < 8; j++) {
      const x = 50 + j * 100;
      s += '<line x1="' + x + '" y1="50" x2="' + x + '" y2="450"/><line x1="' + x + '" y1="550" x2="' + x + '" y2="950"/>';
    }
    s += '<line x1="350" y1="50" x2="550" y2="250"/><line x1="550" y1="50" x2="350" y2="250"/>';
    s += '<line x1="350" y1="750" x2="550" y2="950"/><line x1="550" y1="750" x2="350" y2="950"/>';
    const marks = [[2, 1], [2, 7], [7, 1], [7, 7]];
    for (let c = 0; c < 9; c += 2) marks.push([3, c], [6, c]);
    for (const [r, c] of marks) {
      const x = 50 + c * 100, y = 50 + r * 100;
      for (const dx of [-1, 1]) {
        if ((c === 0 && dx < 0) || (c === 8 && dx > 0)) continue;
        for (const dy of [-1, 1]) {
          const x1 = x + dx * 10, y1 = y + dy * 10;
          s += '<polyline class="g-mark" points="' + (x1 + dx * 18) + ',' + y1 + ' ' + x1 + ',' + y1 + ' ' + x1 + ',' + (y1 + dy * 18) + '"/>';
        }
      }
    }
    s += '<text class="g-river" x="250" y="500">楚 河</text><text class="g-river" x="650" y="500">漢 界</text>';
    s += '</svg>';
    return s;
  }

  class BoardView {
    constructor(root) {
      this.root = root;
      this.flipped = false;
      this.han = true;
      this.board = new Array(90).fill(null);
      this.els = new Array(90).fill(null);
      this.selected = -1;
      this.targets = [];
      this.lastMove = null;
      this.checkSq = -1;
      this.hint = null;
      this.canSelect = () => false;
      this.legalFrom = () => [];
      this.onMove = null;
      this.onSelect = null;
      this.drag = null;

      root.classList.add('xq');
      root.innerHTML =
        '<div class="xq-files top">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => '<span>' + n + '</span>').join('') + '</div>' +
        '<div class="xq-surface">' + gridSVG() + '<div class="xq-marks"></div><div class="xq-pieces"></div></div>' +
        '<div class="xq-files bottom">' + [9, 8, 7, 6, 5, 4, 3, 2, 1].map(n => '<span>' + n + '</span>').join('') + '</div>';
      this.surface = root.querySelector('.xq-surface');
      this.markLayer = root.querySelector('.xq-marks');
      this.pieceLayer = root.querySelector('.xq-pieces');

      this.surface.addEventListener('pointerdown', e => this._down(e));
      this.surface.addEventListener('pointermove', e => this._moveDrag(e));
      this.surface.addEventListener('pointerup', e => this._up(e));
      this.surface.addEventListener('pointercancel', () => this._cancelDrag());
      this.surface.addEventListener('contextmenu', e => e.preventDefault());
    }

    // ── tọa độ ──
    display(s) {
      let r = X.rowOf(s), c = X.colOf(s);
      if (this.flipped) { r = 9 - r; c = 8 - c; }
      return { left: ((c + 0.5) / 9 * 100) + '%', top: ((r + 0.5) / 10 * 100) + '%' };
    }
    squareAt(e) {
      const rect = this.surface.getBoundingClientRect();
      let c = Math.floor((e.clientX - rect.left) / rect.width * 9);
      let r = Math.floor((e.clientY - rect.top) / rect.height * 10);
      if (c < 0 || c > 8 || r < 0 || r > 9) return -1;
      if (this.flipped) { r = 9 - r; c = 8 - c; }
      return r * 9 + c;
    }
    place(el, s) {
      const p = this.display(s);
      el.style.left = p.left;
      el.style.top = p.top;
    }

    // ── quân cờ ──
    paint(el, p) {
      const hidden = p[1] === 'X', col = p[0], t = X.moveType(p);
      el.dataset.p = p;
      el.className = 'xq-piece ' + (col === 'r' ? 'red' : 'black') + (hidden ? ' hidden' : '') + (this.han ? '' : ' vn');
      el.firstChild.textContent = hidden ? '' : (this.han ? X.HAN[col][t] : X.NAMES[t]);
      el.title = hidden ? 'Quân úp – đi như ' + X.NAMES[t] : (col === 'r' ? 'Đỏ ' : 'Đen ') + X.NAMES[t];
    }
    create(s, p) {
      const el = document.createElement('div');
      el.appendChild(document.createElement('span')).className = 'face';
      this.paint(el, p);
      el.style.transition = 'none';
      this.place(el, s);
      this.pieceLayer.appendChild(el);
      void el.offsetWidth;
      el.style.transition = '';
      this.els[s] = el;
      return el;
    }

    /** Cập nhật thế cờ. opts: { lastMove, animate, check: ô tướng bị chiếu } */
    setPosition(board, opts) {
      opts = opts || {};
      const lm = opts.lastMove || null;
      if (opts.animate && lm && this.els[lm.from] && !board[lm.from] && board[lm.to] && this.board[lm.from] &&
          this.board[lm.from][0] === board[lm.to][0]) {
        const victim = this.els[lm.to];
        if (victim) {
          victim.classList.add('taken');
          setTimeout(() => victim.remove(), 260);
        }
        const el = this.els[lm.from];
        this.els[lm.from] = null;
        this.els[lm.to] = el;
        el.style.zIndex = 5;
        this.place(el, lm.to);
        setTimeout(() => { el.style.zIndex = ''; }, 260);
        if (el.dataset.p !== board[lm.to]) {
          const wasHidden = el.dataset.p[1] === 'X';
          this.paint(el, board[lm.to]);
          if (wasHidden) { el.classList.add('reveal'); setTimeout(() => el.classList.remove('reveal'), 600); }
        }
      }
      for (let s = 0; s < 90; s++) {
        const want = board[s], el = this.els[s];
        if (!want && el) { el.remove(); this.els[s] = null; }
        else if (want && !el) this.create(s, want);
        else if (want && el && el.dataset.p !== want) {
          const wasHidden = el.dataset.p[1] === 'X' && want[1] !== 'X' && el.dataset.p[0] === want[0];
          this.paint(el, want);
          if (wasHidden) { el.classList.add('reveal'); setTimeout(() => el.classList.remove('reveal'), 600); }
        }
      }
      this.board = board.slice();
      this.lastMove = lm;
      this.checkSq = opts.check != null ? opts.check : -1;
      if (this.selected >= 0 && (!this.board[this.selected] || !this.canSelect(this.selected))) this.clearSelection(true);
      else if (this.selected >= 0) this.targets = this.legalFrom(this.selected);
      this.renderMarks();
    }

    setFlipped(f) {
      if (this.flipped === !!f) return;
      this.flipped = !!f;
      this.root.classList.toggle('flipped', this.flipped);
      for (let s = 0; s < 90; s++) if (this.els[s]) {
        this.els[s].style.transition = 'none';
        this.place(this.els[s], s);
        void this.els[s].offsetWidth;
        this.els[s].style.transition = '';
      }
      this.renderMarks();
    }

    setHan(han) {
      this.han = !!han;
      for (let s = 0; s < 90; s++) if (this.els[s]) this.paint(this.els[s], this.board[s]);
      this.renderMarks();
    }

    setHint(h) { this.hint = h; this.renderMarks(); }

    setInteractive(canSelect, legalFrom, onMove) {
      this.canSelect = canSelect || (() => false);
      this.legalFrom = legalFrom || (() => []);
      this.onMove = onMove || null;
      if (this.selected >= 0 && !this.canSelect(this.selected)) this.clearSelection();
    }

    clearSelection(silent) {
      if (this.selected >= 0 && this.els[this.selected]) this.els[this.selected].classList.remove('selected');
      this.selected = -1;
      this.targets = [];
      if (!silent) this.renderMarks();
    }

    select(s) {
      this.clearSelection(true);
      this.selected = s;
      this.targets = this.legalFrom(s);
      if (this.els[s]) this.els[s].classList.add('selected');
      if (this.onSelect) this.onSelect(s);
      this.renderMarks();
    }

    renderMarks() {
      const L = this.markLayer;
      L.textContent = '';
      const add = (s, cls) => {
        const d = document.createElement('div');
        d.className = 'xq-mark ' + cls;
        this.place(d, s);
        L.appendChild(d);
      };
      if (this.lastMove) { add(this.lastMove.from, 'last-from'); add(this.lastMove.to, 'last-to'); }
      if (this.hint) { add(this.hint.from, 'hint'); add(this.hint.to, 'hint'); }
      if (this.checkSq >= 0) add(this.checkSq, 'check');
      if (this.selected >= 0) add(this.selected, 'sel');
      for (const m of this.targets) add(m.to, this.board[m.to] ? 'cap' : 'dot');
      for (let s = 0; s < 90; s++) if (this.els[s]) this.els[s].classList.toggle('selected', s === this.selected);
    }

    // ── chuột / cảm ứng ──
    _tryMove(to) {
      const from = this.selected;
      if (from < 0 || !this.targets.some(m => m.to === to)) return false;
      this.clearSelection();
      if (this.onMove) this.onMove(from, to);
      return true;
    }
    _down(e) {
      if (e.button !== 0) return;
      const s = this.squareAt(e);
      if (s < 0) return;
      if (this._tryMove(s)) return;
      if (this.board[s] && this.canSelect(s)) {
        const wasSelected = this.selected === s;
        if (!wasSelected) this.select(s);
        this.drag = { s, x0: e.clientX, y0: e.clientY, el: this.els[s], moved: false, wasSelected, pid: e.pointerId };
        try { this.surface.setPointerCapture(e.pointerId); } catch (err) { /* bỏ qua */ }
      } else if (this.selected >= 0) {
        this.clearSelection();
      }
    }
    _moveDrag(e) {
      const d = this.drag;
      if (!d || !d.el) return;
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (!d.moved && Math.hypot(dx, dy) < 6) return;
      d.moved = true;
      d.el.classList.add('dragging');
      d.el.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(1.08)';
    }
    _up(e) {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      if (d.el) { d.el.classList.remove('dragging'); d.el.style.transform = ''; }
      if (d.moved) {
        const s = this.squareAt(e);
        if (s >= 0 && s !== d.s) this._tryMove(s);
      } else if (d.wasSelected) {
        this.clearSelection();
      }
    }
    _cancelDrag() {
      const d = this.drag;
      this.drag = null;
      if (d && d.el) { d.el.classList.remove('dragging'); d.el.style.transform = ''; }
    }
  }

  window.BoardView = BoardView;
})();
