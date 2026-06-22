const params = new URLSearchParams(window.location.search);
const roomId = params.get('room');
if (!roomId) window.location.href = '/';

const socket = io();
let joined = false;
let myNickname = null;

socket.on('connect', () => {
  if (myNickname) {
    socket.emit('join-room', { roomId, nickname: myNickname });
  }
});
let lastReactionAt = 0;
let votedPollId = null;
let myQuestions = [];

const nicknameScreen = document.getElementById('nicknameScreen');
const audienceScreen = document.getElementById('audienceScreen');
const nicknameInput = document.getElementById('nickname');
const joinBtn = document.getElementById('joinBtn');
const joinError = document.getElementById('joinError');
const displayNickname = document.getElementById('displayNickname');
const roomTitle = document.getElementById('roomTitle');
const audienceCount = document.getElementById('audienceCount');
const emojiGrid = document.getElementById('emojiGrid');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const pollVotePanel = document.getElementById('pollVotePanel');
const pollVoteQuestion = document.getElementById('pollVoteQuestion');
const pollVoteOptions = document.getElementById('pollVoteOptions');
const pollVotedMsg = document.getElementById('pollVotedMsg');
const questionInput = document.getElementById('questionInput');
const submitQuestionBtn = document.getElementById('submitQuestionBtn');
const myQuestionsEl = document.getElementById('myQuestions');
const videoUrl = document.getElementById('videoUrl');
const videoStart = document.getElementById('videoStart');
const videoEnd = document.getElementById('videoEnd');
const playVideoBtn = document.getElementById('playVideoBtn');

async function loadRoom() {
  try {
    const res = await fetch(`/api/rooms/${roomId}`);
    if (!res.ok) { showJoinError('존재하지 않는 연수입니다.'); joinBtn.disabled = true; return; }
    const room = await res.json();
    roomTitle.textContent = room.title || '연수';
  } catch { showJoinError('서버에 연결할 수 없습니다.'); }
}

function showJoinError(msg) { joinError.textContent = msg; joinError.classList.remove('hidden'); }
function hideJoinError() { joinError.classList.add('hidden'); }

function doJoin() {
  const nickname = nicknameInput.value.trim();
  if (!nickname) { showJoinError('닉네임을 입력해주세요.'); nicknameInput.focus(); return; }

  hideJoinError();
  joinBtn.disabled = true;
  joinBtn.textContent = '연결 중...';

  socket.emit('join-room', { roomId, nickname }, (res) => {
    joinBtn.disabled = false;
    joinBtn.textContent = '참여하기';
    if (!res?.ok) { showJoinError(res?.error || '참여에 실패했습니다.'); return; }

    joined = true;
    myNickname = res.nickname;
    displayNickname.textContent = res.nickname;
    nicknameScreen.classList.add('hidden');
    audienceScreen.classList.remove('hidden');
    chatInput.focus();
  });
}

joinBtn.addEventListener('click', doJoin);
nicknameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

/* Tabs */
document.querySelectorAll('.aud-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.aud-tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.aud-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab.dataset.tab}`));
  });
});

/* Reactions */
emojiGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('.emoji-btn');
  if (!btn || !joined) return;
  const now = Date.now();
  if (now - lastReactionAt < 300) return;
  lastReactionAt = now;
  socket.emit('reaction', { emoji: btn.dataset.emoji });
  btn.classList.add('emoji-pop');
  setTimeout(() => btn.classList.remove('emoji-pop'), 200);
  if (navigator.vibrate) navigator.vibrate(30);
});

/* Chat */
function sendChat() {
  if (!joined) return;
  const message = chatInput.value.trim();
  if (!message) return;
  socket.emit('chat', { message });
  chatInput.value = '';
  sendBtn.textContent = '전송됨';
  setTimeout(() => { sendBtn.textContent = '전송'; }, 800);
}
sendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

/* Poll */
function renderPoll(poll) {
  if (!poll?.active) {
    pollVotePanel.classList.add('hidden');
    return;
  }
  pollVotePanel.classList.remove('hidden');
  pollVoteQuestion.textContent = poll.question;
  const alreadyVoted = votedPollId === poll.id;

  if (alreadyVoted) {
    pollVoteOptions.innerHTML = '';
    pollVotedMsg.classList.remove('hidden');
    return;
  }

  pollVotedMsg.classList.add('hidden');
  pollVoteOptions.innerHTML = poll.options.map((o, i) =>
    `<button class="poll-vote-btn" data-idx="${i}">${esc(o.text)}</button>`
  ).join('');

  pollVoteOptions.querySelectorAll('.poll-vote-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (votedPollId === poll.id) return;
      socket.emit('vote-poll', { optionIndex: Number(btn.dataset.idx) });
      votedPollId = poll.id;
      pollVoteOptions.innerHTML = '';
      pollVotedMsg.classList.remove('hidden');
    });
  });
}

/* Questions */
submitQuestionBtn.addEventListener('click', () => {
  const text = questionInput.value.trim();
  if (!text) return;
  socket.emit('submit-question', { text });
  myQuestions.push(text);
  questionInput.value = '';
  renderMyQuestions();
  submitQuestionBtn.textContent = '등록됨!';
  setTimeout(() => { submitQuestionBtn.textContent = '질문 등록'; }, 1000);
});

function renderMyQuestions() {
  if (!myQuestions.length) { myQuestionsEl.innerHTML = ''; return; }
  myQuestionsEl.innerHTML = '<p class="my-q-title">내 질문</p>' +
    myQuestions.map((q) => `<div class="my-q-item">${esc(q)}</div>`).join('');
}

/* Video */
playVideoBtn.addEventListener('click', () => {
  if (!joined) return;
  const url = videoUrl.value.trim();
  if (!url) return;
  socket.emit('play-video', { url, startSec: Number(videoStart.value) || 0, endSec: Number(videoEnd.value) || 60 }, (res) => {
    if (res?.ok === false) {
      playVideoBtn.textContent = '❌ 재접속 필요';
      setTimeout(() => { playVideoBtn.textContent = '▶ 재생'; }, 2500);
    } else {
      playVideoBtn.textContent = '재생됨!';
      setTimeout(() => { playVideoBtn.textContent = '▶ 재생'; }, 1200);
    }
  });
});

/* Socket events */
socket.on('participant-count', (n) => { audienceCount.textContent = n; });
socket.on('room-state', (state) => {
  audienceCount.textContent = state.participantCount;
  renderPoll(state.poll);
});

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

loadRoom();
