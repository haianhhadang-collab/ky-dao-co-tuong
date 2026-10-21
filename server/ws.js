'use strict';
/*
 * WebSocket tối giản (RFC 6455) chỉ dùng thư viện có sẵn của Node.js.
 * Hỗ trợ: bắt tay, khung văn bản, phân mảnh, ping/pong, đóng kết nối.
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 256 * 1024;

class WSConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentSize = 0;
    this.alive = true;
    this.closed = false;
    socket.setNoDelay(true);
    socket.on('data', d => this._onData(d));
    socket.on('close', () => this._finish());
    socket.on('error', () => this._finish());
  }

  _onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (!this.closed) {
      const buf = this.buffer;
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const op = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = buf.readUInt32BE(2) * 4294967296 + buf.readUInt32BE(6); off = 10;
      }
      if (len > MAX_MESSAGE) return this.close(1009);
      if (!masked) return this.close(1002);
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      off += 4;
      const payload = Buffer.from(buf.subarray(off, off + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buffer = buf.subarray(off + len);
      this._onFrame(fin, op, payload);
    }
  }

  _onFrame(fin, op, payload) {
    switch (op) {
      case 0x8: return this.close(1000);
      case 0x9: return this._write(0xA, payload);
      case 0xA: this.alive = true; return;
      case 0x1: case 0x2:
        if (fin) { this.alive = true; this.emit('message', payload.toString('utf8')); }
        else { this.fragments = [payload]; this.fragmentSize = payload.length; }
        return;
      case 0x0:
        this.fragments.push(payload);
        this.fragmentSize += payload.length;
        if (this.fragmentSize > MAX_MESSAGE) return this.close(1009);
        if (fin) {
          const all = Buffer.concat(this.fragments);
          this.fragments = [];
          this.fragmentSize = 0;
          this.alive = true;
          this.emit('message', all.toString('utf8'));
        }
        return;
      default:
        return this.close(1002);
    }
  }

  _write(op, payload) {
    if (this.closed || this.socket.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | op; header[1] = 126; header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | op; header[1] = 127;
      header.writeUInt32BE(Math.floor(len / 4294967296), 2);
      header.writeUInt32BE(len >>> 0, 6);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  send(text) { this._write(0x1, Buffer.from(text, 'utf8')); }

  ping() { this._write(0x9, Buffer.alloc(0)); }

  close(code) {
    if (this.closed) return;
    try {
      const b = Buffer.alloc(2);
      b.writeUInt16BE(code || 1000, 0);
      this._write(0x8, b);
      this.socket.end();
    } catch (e) { /* bỏ qua */ }
    this._finish();
  }

  _finish() {
    if (this.closed) return;
    this.closed = true;
    setTimeout(() => { try { this.socket.destroy(); } catch (e) { /* bỏ qua */ } }, 1000).unref();
    this.emit('close');
  }
}

/** Xử lý sự kiện 'upgrade' của http.Server. */
function handleUpgrade(req, socket, head, onConnection) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  const conn = new WSConnection(socket);
  onConnection(conn, req);
  if (head && head.length) conn._onData(head);
}

module.exports = { handleUpgrade, WSConnection };
