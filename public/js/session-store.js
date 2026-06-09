const SESSION_KEY = 'slides-live-sessions';

function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveSessions(sessions) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
}

function saveSession(data) {
  const sessions = loadSessions();
  const existing = sessions.findIndex((s) => s.roomId === data.roomId);
  const entry = { ...data, savedAt: Date.now() };
  if (existing >= 0) sessions[existing] = entry;
  else sessions.unshift(entry);
  if (sessions.length > 50) sessions.length = 50;
  saveSessions(sessions);
  return entry;
}

function searchSessions(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return loadSessions();
  return loadSessions().filter((s) => {
    const blob = JSON.stringify(s).toLowerCase();
    return (s.title || '').toLowerCase().includes(q)
      || (s.roomId || '').includes(q)
      || blob.includes(q);
  });
}

function deleteSession(roomId) {
  const sessions = loadSessions().filter((s) => s.roomId !== roomId);
  saveSessions(sessions);
}

function extractKeywords(messages, limit = 30) {
  const stop = new Set(['은','는','이','가','을','를','의','에','와','과','도','로','으로','에서','하다','있다','없다','the','a','an','is','are','to','of','in','and','or','it','that','this']);
  const freq = {};
  for (const msg of messages) {
    const text = (msg.message || msg).toLowerCase();
    const tokens = text.match(/[\uac00-\ud7a3]+|[a-zA-Z]{2,}/g) || [];
    for (const t of tokens) {
      if (t.length < 2 || stop.has(t)) continue;
      freq[t] = (freq[t] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

window.SessionStore = { loadSessions, saveSession, searchSessions, deleteSession, extractKeywords };
