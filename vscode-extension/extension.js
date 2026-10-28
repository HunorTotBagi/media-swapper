// Tells the Media Swapper Chrome extension when this VS Code window gets focus.
//
// A Chrome extension can't listen on a port, so VS Code hosts a tiny WebSocket
// server on 127.0.0.1 and Chrome connects to it. Only one VS Code window can
// own the port; the other windows forward their focus events to it over HTTP.

const vscode = require('vscode');
const http = require('http');
const crypto = require('crypto');

const PORT = 47823;
const FOCUS_DELAY_MS = 1000; // ignore quick alt-tabs through VS Code

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
      render(); // pick up a toggle made in another window
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

  // Another window owns the port, so ask it to pass the event on.
  const req = http.request({
    host: '127.0.0.1',
    port: PORT,
    method: 'POST',
    path: '/vscode-focused',
    headers: { 'X-Media-Swapper': '1' },
  });
  req.on('error', () => startServer()); // that window closed: take over (Chrome reconnects within 30s)
  req.end();
}

function startServer() {
  const candidate = http.createServer((req, res) => {
    // Web pages can't send a custom header cross-origin without CORS approval,
    // so requiring one stops random sites from triggering a swap.
    if (req.method === 'POST' && req.url === '/vscode-focused' && req.headers['x-media-swapper']) {
      broadcast('vscode-focused');
    }
    res.end();
  });
  candidate.on('upgrade', acceptWebSocket);
  candidate.on('error', () => {}); // port already owned by another VS Code window
  candidate.listen(PORT, '127.0.0.1', () => (server = candidate));
}

// Just enough of a WebSocket server to push short text messages to Chrome.
function acceptWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  // Only the Chrome extension may connect, not arbitrary web pages.
  if (!key || !String(req.headers.origin).startsWith('chrome-extension://')) return socket.destroy();

  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  sockets.add(socket);
  socket.resume(); // discard Chrome's keepalives; we only need to notice the disconnect
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => socket.destroy());
}

function broadcast(message) {
  // An unmasked text frame. Our messages are short (< 126 bytes), so the
  // length fits in the second header byte.
  const payload = Buffer.from(message);
  const frame = Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  for (const socket of sockets) socket.write(frame);
}

module.exports = { activate, deactivate };
