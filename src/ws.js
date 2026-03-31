let socket = null;
let wasConnected = false;
const handlers = new Map();

function connect() {
  const wsHost = window.location.host;
  socket = new WebSocket(`ws://${wsHost}/ws`);
  socket.onopen = () => {
    if (wasConnected) {
      (handlers.get('__reconnect__') || []).forEach(h => h());
    }
    wasConnected = true;
  };
  socket.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      (handlers.get(msg.type) || []).forEach(h => h(msg));
    } catch {}
  };
  socket.onclose = () => setTimeout(connect, 2000);
  return socket;
}

export function getSocket() {
  if (!socket || socket.readyState > 1) return connect();
  return socket;
}

export function send(data) {
  const ws = getSocket();
  const doSend = () => ws.send(JSON.stringify(data));
  if (ws.readyState === 1) doSend();
  else ws.addEventListener('open', doSend, { once: true });
}

export function on(type, handler) {
  if (!handlers.has(type)) handlers.set(type, []);
  handlers.get(type).push(handler);
  return () => {
    const arr = handlers.get(type);
    const i = arr.indexOf(handler);
    if (i > -1) arr.splice(i, 1);
  };
}
