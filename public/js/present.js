const params = new URLSearchParams(window.location.search);
const roomId = params.get('room');
if (!roomId) window.location.href = '/';

const socket = io();
socket.on('connect', () => socket.emit('presenter-join', { roomId }));

let joinUrl = '';
let roomTitle = '연수';
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
const videoOverlay = document.getElementById('videoOverlay');
const videoFrame = document.getElementById('videoFrame');
const closeVideoBtn = document.getElementById('closeVideoBtn');
const stopVideoBtn = document.getElementById('stopVideoBtn');

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
  await loadSlide(room);
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
socket.on('play-video', ({ url, startSec, endSec }) => {
  const m = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (!m) return;
  videoFrame.src = `https://www.youtube.com/embed/${m[1]}?start=${startSec}&end=${endSec}&autoplay=1`;
  videoOverlay.classList.remove('hidden');
});
socket.on('new-question', ({ nickname, text }) => spawnQuestionToast(nickname, text));
socket.on('room-state', handleRoomState);

function handleRoomState(state) {
  updateCount(state.participantCount);
  renderReactionStats(state.reactionStats || {});
  renderPoll(state.poll);
  renderQuestions(state.questions || []);
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

/* ── Question Toast ── */
function spawnQuestionToast(nickname, text) {
  const toast = document.createElement('div');
  toast.className = 'question-toast';
  toast.innerHTML = `<div class="q-toast-label">🙋 ${esc(nickname)} 질문</div><div class="q-toast-text">${esc(text)}</div>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5100);
}

/* ── Video ── */
function stopVideo() {
  videoFrame.src = '';
  videoOverlay.classList.add('hidden');
}

closeVideoBtn.addEventListener('click', stopVideo);
stopVideoBtn.addEventListener('click', stopVideo);

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
