const params = new URLSearchParams(window.location.search);
const roomId = params.get('room');
if (!roomId) window.location.href = '/';

const socket = io();
socket.emit('presenter-join', { roomId });

let joinUrl = '';
let roomTitle = '연수';
let allChats = [];
let focusTimeline = [];
let timerInterval = null;
let timerRemaining = 0;
let timerRunning = false;

/* DOM refs */
const slideFrame = document.getElementById('slideFrame');
const canvaContainer = document.getElementById('canvaContainer');
const slideLoading = document.getElementById('slideLoading');
const slideFallback = document.getElementById('slideFallback');
const fallbackDesc = document.getElementById('fallbackDesc');
const fallbackLink = document.getElementById('fallbackLink');
const reactionStream = document.getElementById('reactionStream');
const chatStream = document.getElementById('chatStream');
const reactionStatsBar = document.getElementById('reactionStatsBar');
const qrImage = document.getElementById('qrImage');
const joinUrlEl = document.getElementById('joinUrl');
const lanHint = document.getElementById('lanHint');
const participantCountEl = document.getElementById('participantCount');
const topbarCount = document.getElementById('topbarCount');
const presentTitle = document.getElementById('presentTitle');
const slideTypeBadge = document.getElementById('slideTypeBadge');
const qrPanel = document.getElementById('qrPanel');
const qrToggle = document.getElementById('qrToggle');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const activityPanel = document.getElementById('activityPanel');
const activityToggle = document.getElementById('activityToggle');
const activityList = document.getElementById('activityList');
const pollOverlay = document.getElementById('pollOverlay');
const pollOverlayQuestion = document.getElementById('pollOverlayQuestion');
const pollBars = document.getElementById('pollBars');
const dockToggle = document.getElementById('dockToggle');
const dockBody = document.getElementById('dockBody');
const pollQuestion = document.getElementById('pollQuestion');
const pollOptionsInput = document.getElementById('pollOptionsInput');
const addPollOption = document.getElementById('addPollOption');
const createPollBtn = document.getElementById('createPollBtn');
const closePollBtn = document.getElementById('closePollBtn');
const questionList = document.getElementById('questionList');
const timerDisplay = document.getElementById('timerDisplay');
const timerBadge = document.getElementById('timerBadge');
const timerMinutes = document.getElementById('timerMinutes');
const timerStart = document.getElementById('timerStart');
const timerPause = document.getElementById('timerPause');
const timerReset = document.getElementById('timerReset');
const wordCloudCanvas = document.getElementById('wordCloudCanvas');
const focusChartCanvas = document.getElementById('focusChartCanvas');
const slideNextCount = document.getElementById('slideNextCount');
const slidePrevCount = document.getElementById('slidePrevCount');
const resetSlideReq = document.getElementById('resetSlideReq');
const saveSessionBtn = document.getElementById('saveSessionBtn');
const sessionSearch = document.getElementById('sessionSearch');
const sessionList = document.getElementById('sessionList');

/* ── Init ── */
async function init() {
  const [roomRes, qrRes] = await Promise.all([
    fetch(`/api/rooms/${roomId}`),
    fetch(`/api/rooms/${roomId}/qr`),
  ]);
  if (!roomRes.ok) { alert('연수를 찾을 수 없습니다.'); window.location.href = '/'; return; }

  const room = await roomRes.json();
  const qr = await qrRes.json();
  roomTitle = room.title || '연수';
  presentTitle.textContent = roomTitle;
  joinUrl = qr.joinUrl;
  qrImage.src = qr.qrDataUrl;
  joinUrlEl.textContent = qr.joinUrl;
  if (qr.lanIp) lanHint.textContent = `같은 Wi-Fi: ${qr.lanIp}:${qr.port}`;

  updateCount(room.participantCount || 0);
  renderReactionStats(room.reactionStats || {});
  if (room.focusTimeline) focusTimeline = room.focusTimeline;
  renderFocusChart();
  await loadSlide(room);
  renderSessionList();
}

async function loadSlide(room) {
  slideTypeBadge.textContent = room.slideType === 'canva' ? 'Canva' : room.slideType === 'google' ? 'Google' : 'Embed';
  if (room.slideType === 'canva' && room.canvaDesignId) { await loadCanva(room); return; }
  if (room.embedUrl) { loadIframe(room.embedUrl, room.slideUrl); return; }
  showFallback(room.slideUrl, '지원하지 않는 슬라이드 형식입니다.');
}

function loadIframe(src, fallbackUrl) {
  slideFrame.classList.remove('hidden');
  slideFrame.src = src;
  slideFrame.onload = () => hideLoading();
  setTimeout(hideLoading, 6000);
  fallbackLink.href = fallbackUrl || src;
}

async function loadCanva(room) {
  canvaContainer.classList.remove('hidden');
  canvaContainer.innerHTML = `<div class="canva-embed" data-design-id="${escapeAttr(room.canvaDesignId)}" data-height-ratio="0.5625" style="width:100%;height:100%;padding:0;margin:0;"></div>`;
  fallbackLink.href = room.canvaViewUrl || room.slideUrl;
  if (!document.querySelector('script[data-canva-sdk]')) {
    const script = document.createElement('script');
    script.src = 'https://sdk.canva.com/v1/embed.js';
    script.async = true;
    script.dataset.canvaSdk = '1';
    script.onload = () => { hideLoading(); setTimeout(checkCanvaLoaded, 8000); };
    script.onerror = () => showCanvaFallback(room);
    document.body.appendChild(script);
  } else {
    if (window.Canva?.Embed?.init) window.Canva.Embed.init();
    hideLoading();
  }
}

function checkCanvaLoaded() {
  if (!canvaContainer.querySelector('iframe')) showCanvaFallback({ canvaViewUrl: fallbackLink.href });
}

function showCanvaFallback(room) {
  showFallback(room.canvaViewUrl || room.slideUrl, '캔바 공유 > Embed > 공개 임베드를 확인하세요.');
}

function showFallback(url, desc) {
  hideLoading();
  slideFallback.classList.remove('hidden');
  fallbackDesc.textContent = desc;
  fallbackLink.href = url;
}

function hideLoading() { slideLoading.classList.add('hidden'); }

/* ── Socket ── */
socket.on('reaction', ({ emoji, nickname }) => spawnEmoji(emoji, nickname));
socket.on('chat', ({ message, nickname, timestamp }) => {
  spawnChatBubble(message, nickname);
  addActivityLog(nickname, message, timestamp);
});
socket.on('participant-count', updateCount);
socket.on('reaction-stats', renderReactionStats);
socket.on('focus-update', (data) => { focusTimeline = data; renderFocusChart(); });
socket.on('wordcloud-update', (chats) => { allChats = chats; renderWordCloud(); });
socket.on('slide-request-update', renderSlideRequests);
socket.on('room-state', handleRoomState);

function handleRoomState(state) {
  updateCount(state.participantCount);
  renderReactionStats(state.reactionStats || {});
  renderPoll(state.poll);
  renderQuestions(state.questions || []);
  renderSlideRequests(state.slideRequests);
  if (state.focusTimeline) { focusTimeline = state.focusTimeline; renderFocusChart(); }
}

function updateCount(n) {
  participantCountEl.textContent = n;
  topbarCount.textContent = n;
}

/* ── Reactions & Chat ── */
function spawnEmoji(emoji, nickname) {
  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  el.title = nickname;
  const h = reactionStream.clientHeight || 600;
  el.style.bottom = `${h - (Math.random() * h * 0.6 + h * 0.2)}px`;
  el.style.left = `${10 + Math.random() * 60}px`;
  reactionStream.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function spawnChatBubble(message, nickname) {
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.innerHTML = `<div class="chat-nickname">${esc(nickname)}</div><div class="chat-message">${esc(message)}</div>`;
  chatStream.appendChild(bubble);
  if (chatStream.children.length > 5) chatStream.firstChild.remove();
  setTimeout(() => bubble.remove(), 6000);
}

function addActivityLog(nickname, message, timestamp) {
  const item = document.createElement('div');
  item.className = 'activity-item';
  const time = new Date(timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  item.innerHTML = `<span class="activity-time">${time}</span><span class="activity-nick">${esc(nickname)}</span><span class="activity-msg">${esc(message)}</span>`;
  activityList.prepend(item);
  while (activityList.children.length > 30) activityList.lastChild.remove();
}

function renderReactionStats(stats) {
  const entries = Object.entries(stats).sort((a, b) => b[1] - a[1]);
  reactionStatsBar.innerHTML = entries.map(([e, c]) => `<span class="stat-chip">${e} ${c}</span>`).join('');
}

/* ── Poll ── */
function renderPoll(poll) {
  if (!poll?.active) {
    pollOverlay.classList.add('hidden');
    return;
  }
  pollOverlay.classList.remove('hidden');
  pollOverlayQuestion.textContent = poll.question;
  const max = Math.max(...poll.options.map((o) => o.votes), 1);
  pollBars.innerHTML = poll.options.map((o) => {
    const pct = Math.round((o.votes / max) * 100);
    return `<div class="poll-bar-row"><span class="poll-bar-label">${esc(o.text)}</span><div class="poll-bar-track"><div class="poll-bar-fill" style="width:${pct}%"></div></div><span class="poll-bar-count">${o.votes}</span></div>`;
  }).join('');
}

addPollOption.addEventListener('click', () => {
  const n = pollOptionsInput.children.length + 1;
  if (n > 6) return;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'poll-opt';
  inp.placeholder = `선택지 ${n}`;
  inp.maxLength = 50;
  pollOptionsInput.appendChild(inp);
});

createPollBtn.addEventListener('click', () => {
  const question = pollQuestion.value.trim();
  const options = [...pollOptionsInput.querySelectorAll('.poll-opt')].map((i) => i.value.trim()).filter(Boolean);
  if (!question || options.length < 2) { alert('질문과 선택지 2개 이상을 입력하세요.'); return; }
  socket.emit('create-poll', { question, options });
});

closePollBtn.addEventListener('click', () => socket.emit('close-poll'));

/* ── Questions ── */
function renderQuestions(questions) {
  const pending = questions.filter((q) => !q.answered);
  const done = questions.filter((q) => q.answered);
  const sorted = [...pending, ...done];
  if (!sorted.length) {
    questionList.innerHTML = '<p class="empty-msg">등록된 질문이 없습니다.</p>';
    return;
  }
  questionList.innerHTML = sorted.map((q) => `
    <div class="question-item ${q.answered ? 'answered' : ''}">
      <div class="q-meta"><span class="q-nick">${esc(q.nickname)}</span><span class="q-time">${fmtTime(q.timestamp)}</span></div>
      <div class="q-text">${esc(q.text)}</div>
      ${q.answered ? '<span class="q-done">✅ 답변 완료</span>' : `<button class="btn-sm btn-resolve" data-id="${q.id}">답변 완료</button>`}
    </div>
  `).join('');

  questionList.querySelectorAll('.btn-resolve').forEach((btn) => {
    btn.addEventListener('click', () => socket.emit('resolve-question', { questionId: btn.dataset.id }));
  });
}

/* ── Timer ── */
function fmtTimer(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function tickTimer() {
  if (timerRemaining <= 0) { clearInterval(timerInterval); timerRunning = false; timerBadge.classList.add('timer-done'); return; }
  timerRemaining--;
  const t = fmtTimer(timerRemaining);
  timerDisplay.textContent = t;
  timerBadge.textContent = `⏱️ ${t}`;
}

timerStart.addEventListener('click', () => {
  if (!timerRunning) {
    if (timerRemaining <= 0) timerRemaining = Number(timerMinutes.value || 5) * 60;
    timerRunning = true;
    timerBadge.classList.remove('hidden', 'timer-done');
    timerInterval = setInterval(tickTimer, 1000);
    tickTimer();
  }
});

timerPause.addEventListener('click', () => {
  timerRunning = false;
  clearInterval(timerInterval);
});

timerReset.addEventListener('click', () => {
  timerRunning = false;
  clearInterval(timerInterval);
  timerRemaining = Number(timerMinutes.value || 5) * 60;
  const t = fmtTimer(timerRemaining);
  timerDisplay.textContent = t;
  timerBadge.textContent = `⏱️ ${t}`;
  timerBadge.classList.remove('timer-done');
});

/* ── Word Cloud ── */
function renderWordCloud() {
  const canvas = wordCloudCanvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const keywords = SessionStore.extractKeywords(allChats, 20);
  if (!keywords.length) {
    ctx.fillStyle = '#9898b0';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('채팅이 쌓이면 표시됩니다', canvas.width / 2, canvas.height / 2);
    return;
  }
  const max = keywords[0].count;
  const colors = ['#6c63ff', '#4ade80', '#f87171', '#fbbf24', '#38bdf8', '#c084fc'];
  const placed = [];
  keywords.forEach((kw, i) => {
    const size = 12 + (kw.count / max) * 22;
    ctx.font = `bold ${size}px sans-serif`;
    const w = ctx.measureText(kw.word).width;
    const h = size;
    let x, y, ok = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      x = Math.random() * (canvas.width - w - 10) + 5;
      y = Math.random() * (canvas.height - h - 10) + h;
      ok = !placed.some((p) => Math.abs(p.x - x) < p.w + 4 && Math.abs(p.y - y) < p.h + 4);
      if (ok) break;
    }
    if (!ok) return;
    placed.push({ x, y, w, h });
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillText(kw.word, x, y);
  });
}

/* ── Focus Chart ── */
function renderFocusChart() {
  const canvas = focusChartCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (!focusTimeline.length) {
    ctx.fillStyle = '#9898b0';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('반응이 쌓이면 표시됩니다', w / 2, h / 2);
    return;
  }

  const data = focusTimeline.slice(-20);
  const max = Math.max(...data.map((d) => d.count), 1);
  const pad = 20;
  const chartW = w - pad * 2;
  const chartH = h - pad * 2;

  ctx.strokeStyle = '#3a3a55';
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();

  ctx.strokeStyle = '#6c63ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = pad + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = h - pad - (d.count / max) * chartH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#6c63ff';
  data.forEach((d, i) => {
    const x = pad + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = h - pad - (d.count / max) * chartH;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

/* ── Slide Requests ── */
function renderSlideRequests(req) {
  if (!req) return;
  slideNextCount.textContent = req.next;
  slidePrevCount.textContent = req.prev;
}

resetSlideReq.addEventListener('click', () => socket.emit('reset-slide-requests'));

/* ── Session ── */
saveSessionBtn.addEventListener('click', () => {
  socket.emit('get-session-data', (data) => {
    if (!data) return;
    SessionStore.saveSession(data);
    saveSessionBtn.textContent = '저장됨!';
    setTimeout(() => { saveSessionBtn.textContent = '세션 저장'; }, 2000);
    renderSessionList();
  });
});

function renderSessionList() {
  const q = sessionSearch.value;
  const sessions = SessionStore.searchSessions(q);
  if (!sessions.length) {
    sessionList.innerHTML = '<p class="empty-msg">저장된 세션이 없습니다.</p>';
    return;
  }
  sessionList.innerHTML = sessions.map((s) => `
    <div class="session-item">
      <div class="session-item-title">${esc(s.title || s.roomId)}</div>
      <div class="session-item-meta">${new Date(s.savedAt).toLocaleString('ko-KR')} · 💬${s.chats?.length || 0} · 🙋${s.questions?.length || 0}</div>
      <button class="btn-sm btn-delete-session" data-id="${s.roomId}">삭제</button>
    </div>
  `).join('');

  sessionList.querySelectorAll('.btn-delete-session').forEach((btn) => {
    btn.addEventListener('click', () => {
      SessionStore.deleteSession(btn.dataset.id);
      renderSessionList();
    });
  });
}

sessionSearch.addEventListener('input', renderSessionList);

/* ── Dock tabs ── */
dockToggle.addEventListener('click', () => {
  dockBody.classList.toggle('hidden');
  dockToggle.textContent = dockBody.classList.contains('hidden') ? '🛠️ 도구 ▲' : '🛠️ 도구 ▼';
});

document.querySelectorAll('.dock-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.dock-tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.dock-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab.dataset.tab}`));
  });
});

qrToggle.addEventListener('click', () => {
  qrPanel.classList.toggle('collapsed');
  qrToggle.textContent = qrPanel.classList.contains('collapsed') ? '▶' : '◀';
});

activityToggle.addEventListener('click', () => activityPanel.classList.toggle('collapsed'));

copyLinkBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(joinUrl);
    copyLinkBtn.textContent = '복사됨!';
    setTimeout(() => { copyLinkBtn.textContent = '링크 복사'; }, 2000);
  } catch { prompt('링크 복사:', joinUrl); }
});

fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
});

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }
function fmtTime(ts) { return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }); }

init();
