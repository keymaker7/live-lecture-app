/* global supabase */

class SupabaseRealtime {
  constructor(roomId, role = 'audience') {
    this.roomId = roomId;
    this.role = role;
    this.client = null;
    this.channels = [];
    this.handlers = {};
  }

  on(event, fn) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(fn);
  }

  emit(event, data) {
    (this.handlers[event] || []).forEach((fn) => fn(data));
  }

  async connect(url, key) {
    if (!window.supabase?.createClient) {
      await this._loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js');
    }
    this.client = window.supabase.createClient(url, key);

    this._sub(`room:${this.roomId}`, 'room-state', (p) => this.emit('room-state', p));
    this._sub(`room:${this.roomId}`, 'reaction', (p) => this.emit('reaction', p));
    this._sub(`room:${this.roomId}`, 'chat', (p) => this.emit('chat', p));
    this._sub(`room:${this.roomId}`, 'reaction-stats', (p) => this.emit('reaction-stats', p));
    this._sub(`room:${this.roomId}`, 'focus-update', (p) => this.emit('focus-update', p));
    this._sub(`room:${this.roomId}`, 'wordcloud-update', (p) => this.emit('wordcloud-update', p));
    this._sub(`room:${this.roomId}`, 'participant-count', (p) => this.emit('participant-count', p));
    this._sub(`room:${this.roomId}`, 'slide-request-update', (p) => this.emit('slide-request-update', p));

    if (this.role === 'presenter') {
      await this._broadcast('presenter-join', { roomId: this.roomId });
    }
    return true;
  }

  _sub(channelName, event, fn) {
    const ch = this.client.channel(channelName);
    ch.on('broadcast', { event }, ({ payload }) => fn(payload)).subscribe();
    this.channels.push(ch);
  }

  async _broadcast(event, payload) {
    const ch = this.client.channel(`room:${this.roomId}`);
    await ch.subscribe();
    await ch.send({ type: 'broadcast', event, payload });
  }

  async send(event, payload) {
    await this._broadcast(event, payload);
  }

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  disconnect() {
    this.channels.forEach((ch) => ch.unsubscribe());
    this.channels = [];
  }
}

window.SupabaseRealtime = SupabaseRealtime;
