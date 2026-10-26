// Transport: WebSocket to Node-RED. The static web demo (web/demo) swaps this file for an
// in-browser engine with the same two calls, so the pages themselves never change.
const Transport = {
  ws: null,
  connect(onData, onStatus) {
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => { this.ws = ws; onStatus(true); };
    ws.onmessage = e => onData(e.data);
    ws.onclose = () => { onStatus(false); setTimeout(() => this.connect(onData, onStatus), 2000); };
  },
  send(text) { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(text); }
};
