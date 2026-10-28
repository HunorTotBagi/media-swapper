const vscode = require('vscode');
const http = require('http');
const crypto = require('crypto');

const PORT = 47823;
const FOCUS_DELAY_MS = 1000;

let server;
const sockets = new Set();
let focusTimer;

function activate(context) {
  const isEnabled = () => context.globalState.get('autoSwap', true);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'mediaSwapper.toggleAutoSwap';
  const render = () => {
    status.text = isEnabled() ? '$(unmute) Auto-swap' : '$(mute) Auto-swap off';
    status.tooltip = isEnabled()
      ? 'Media Swapper: focusing VS Code pauses YouTube and plays Spotify. Click to turn off.'
      : 'Media Swapper: auto-swap is off. Click to turn on.';
  };
  render();
  status.show();

  context.subscriptions.push(
    status,
    vscode.commands.registerCommand('mediaSwapper.toggleAutoSwap', async () => {
      await context.globalState.update('autoSwap', !isEnabled());
      render();
    }),
    vscode.window.onDidChangeWindowState((state) => {
      clearTimeout(focusTimer);
      render();
      if (state.focused && isEnabled()) focusTimer = setTimeout(sendFocus, FOCUS_DELAY_MS);
    }),
  );

  startServer();
}

function deactivate() {
  clearTimeout(focusTimer);
  for (const socket of sockets) socket.destroy();
  server?.close();
}

function sendFocus() {
  if (server) return broadcast('vscode-focused');

  const req = http.request({
    host: '127.0.0.1',
    port: PORT,
    method: 'POST',
    path: '/vscode-focused',
    headers: { 'X-Media-Swapper': '1' },
  });
  req.on('error', () => startServer());
  req.end();
}

function startServer() {
  const candidate = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/vscode-focused' && req.headers['x-media-swapper']) {
      broadcast('vscode-focused');
    }
    res.end();
  });
  candidate.on('upgrade', acceptWebSocket);
  candidate.on('error', () => {});
  candidate.listen(PORT, '127.0.0.1', () => (server = candidate));
}

function acceptWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || !String(req.headers.origin).startsWith('chrome-extension://')) return socket.destroy();

  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  sockets.add(socket);
  socket.resume();
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => socket.destroy());
}

function broadcast(message) {
  const payload = Buffer.from(message);
  const frame = Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  for (const socket of sockets) socket.write(frame);
}

module.exports = { activate, deactivate };
