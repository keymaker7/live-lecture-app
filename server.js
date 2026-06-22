require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const FOCUS_BUCKET_MS = 30000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

function createRoomState(overrides = {}) {
  return {
    poll: null,
    questions: [],
    slideRequests: { next: 0, prev: 0 },
    focusTimeline: [],
    allChats: [],
    allReactions: [],
    allPolls: [],
    ...overrides,
  };
}

function getFocusBucket(room) {
  const now = Date.now();
  const key = Math.floor(now / FOCUS_BUCKET_MS) * FOCUS_BUCKET_MS;
  let bucket = room.focusTimeline.find((b) => b.time === key);
  if (!bucket) {
    bucket = { time: key, count: 0 };
    room.focusTimeline.push(bucket);
    if (room.focusTimeline.length > 120) room.focusTimeline.shift();
  }
  return bucket;
}

function getRoomState(room) {
  return {
    poll: room.poll ? {
      id: room.poll.id,
      question: room.poll.question,
      options: room.poll.options.map((o) => ({ text: o.text, votes: o.votes })),
      active: room.poll.active,
    } : null,
    questions: room.questions,
    slideRequests: { ...room.slideRequests },
    focusTimeline: [...room.focusTimeline],
    participantCount: room.participants.size,
    reactionStats: { ...room.reactionStats },
  };
}

function broadcastState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit('room-state', getRoomState(room));
}

/* ── URL parsing (unchanged) ── */
function parseCanvaFromEmbedHtml(input) {
  const designId = input.match(/data-design-id="([A-Za-z0-9_-]+)"/)?.[1];
  if (designId) return { type: 'canva', designId, viewUrl: buildCanvaViewUrl(designId) };
  const iframeSrc = input.match(/src="(https:\/\/www\.canva\.com\/[^"]+)"/)?.[1];
  if (iframeSrc) return parseCanvaUrl(iframeSrc);
  return null;
}

function buildCanvaViewUrl(designId, viewToken) {
  let url = `https://www.canva.com/design/${designId}`;
  if (viewToken && viewToken !== 'view' && viewToken !== 'edit') url += `/${viewToken}`;
  url += `/view?utm_content=${designId}&utm_campaign=designshare&utm_medium=embeds&utm_source=slides-live`;
  return url;
}

function parseCanvaUrl(url) {
  const match = url.match(/canva\.com\/design\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?/i);
  if (!match) return null;
  const designId = match[1];
  const segment = match[2];
  const viewToken = segment && !['view', 'edit'].includes(segment) ? segment : null;
  return { type: 'canva', designId, viewUrl: buildCanvaViewUrl(designId, viewToken) };
}

async function fetchCanvaOembed(viewUrl) {
  const endpoints = [
    `https://api.canva.com/_spi/presentation/_oembed?url=${encodeURIComponent(viewUrl)}&format=json`,
    `https://www.canva.com/_oembed?url=${encodeURIComponent(viewUrl)}&format=json`,
  ];
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, { headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.html || data.designId) return data;
    } catch { /* next */ }
  }
  return null;
}

function extractDesignIdFromOembed(html) {
  return html?.match(/data-design-id="([A-Za-z0-9_-]+)"/)?.[1] || null;
}

async function parseSlideInput(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  if (trimmed.includes('data-design-id') || trimmed.includes('<iframe')) {
    const fromHtml = parseCanvaFromEmbedHtml(trimmed);
    if (fromHtml) return fromHtml;
  }

  const googleMatch = trimmed.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  if (googleMatch) {
    return {
      type: 'google',
      embedUrl: `https://docs.google.com/presentation/d/${googleMatch[1]}/embed?start=false&loop=false&delayms=3000`,
      slideUrl: trimmed,
    };
  }

  if (/canva\.com/i.test(trimmed)) {
    const canva = parseCanvaUrl(trimmed);
    if (!canva) return null;
    const oembed = await fetchCanvaOembed(canva.viewUrl);
    if (oembed?.html) {
      const designId = extractDesignIdFromOembed(oembed.html) || canva.designId;
      return { type: 'canva', designId, viewUrl: canva.viewUrl };
    }
    return canva;
  }

  if (trimmed.includes('/embed') || trimmed.includes('?embed')) {
    return { type: 'iframe', embedUrl: trimmed, slideUrl: trimmed };
  }
  return { type: 'iframe', embedUrl: trimmed, slideUrl: trimmed };
}

function buildJoinUrl(req, roomId) {
  const lanIp = getLanIp();
  if (lanIp) return `http://${lanIp}:${PORT}/join.html?room=${roomId}`;
  return `${req.protocol}://${req.get('host')}/join.html?room=${roomId}`;
}

/* ── REST ── */
app.get('/api/network', (req, res) => {
  const lanIp = getLanIp();
  res.json({ lanIp, port: PORT, joinBase: lanIp ? `http://${lanIp}:${PORT}` : null });
});

app.get('/api/config', (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
  res.json({
    supabaseUrl: supabaseUrl || null,
    supabaseKey: supabaseKey || null,
    supabaseEnabled: !!(supabaseUrl && supabaseKey),
    realtimeMode: supabaseUrl && supabaseKey ? 'supabase' : 'socketio',
  });
});

app.post('/api/rooms', async (req, res) => {
  const { slideUrl, title } = req.body;
  if (!slideUrl) return res.status(400).json({ error: '슬라이드 URL이 필요합니다.' });

  const parsed = await parseSlideInput(slideUrl);
  if (!parsed) return res.status(400).json({ error: '슬라이드 URL을 인식할 수 없습니다.' });

  const roomId = uuidv4().slice(0, 8);
  const state = createRoomState();

  rooms.set(roomId, {
    id: roomId,
    title: title || '연수',
    slideUrl,
    slideType: parsed.type,
    embedUrl: parsed.embedUrl || null,
    canvaDesignId: parsed.designId || null,
    canvaViewUrl: parsed.viewUrl || null,
    createdAt: Date.now(),
    participants: new Map(),
    reactionStats: {},
    recentChats: [],
    ...state,
  });

  res.json({
    roomId,
    slideType: parsed.type,
    embedUrl: parsed.embedUrl,
    canvaDesignId: parsed.designId,
    canvaViewUrl: parsed.viewUrl,
  });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: '연수를 찾을 수 없습니다.' });
  res.json({
    id: room.id,
    title: room.title,
    slideType: room.slideType,
    embedUrl: room.embedUrl,
    canvaDesignId: room.canvaDesignId,
    canvaViewUrl: room.canvaViewUrl,
    slideUrl: room.slideUrl,
    participantCount: room.participants.size,
    reactionStats: room.reactionStats,
    ...getRoomState(room),
  });
});

app.get('/api/rooms/:roomId/qr', async (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: '연수를 찾을 수 없습니다.' });

  const joinUrl = buildJoinUrl(req, room.id);
  try {
    const qrDataUrl = await QRCode.toDataURL(joinUrl, {
      width: 200, margin: 2, color: { dark: '#1a1a2e', light: '#ffffff' },
    });
    res.json({ joinUrl, qrDataUrl, lanIp: getLanIp(), port: PORT });
  } catch {
    res.status(500).json({ error: 'QR 코드 생성 실패' });
  }
});

/* ── Socket ── */
io.on('connection', (socket) => {
  socket.on('presenter-join', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    socket.join(roomId);
    socket.roomId = roomId;
    socket.isPresenter = true;
    socket.emit('room-state', getRoomState(room));
  });

  socket.on('join-room', ({ roomId, nickname }, callback) => {
    const room = rooms.get(roomId);
    if (!room) return callback?.({ ok: false, error: '존재하지 않는 연수입니다.' });

    const trimmed = (nickname || '').trim().slice(0, 20);
    if (!trimmed) return callback?.({ ok: false, error: '닉네임을 입력해주세요.' });

    room.participants.set(socket.id, { id: socket.id, nickname: trimmed, joinedAt: Date.now() });
    socket.join(roomId);
    socket.roomId = roomId;
    socket.nickname = trimmed;

    io.to(roomId).emit('participant-count', room.participants.size);
    socket.emit('room-state', getRoomState(room));
    callback?.({ ok: true, nickname: trimmed });
  });

  socket.on('reaction', ({ emoji }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;

    const nickname = socket.nickname || '익명';
    room.reactionStats[emoji] = (room.reactionStats[emoji] || 0) + 1;
    getFocusBucket(room).count += 1;

    const payload = { emoji, nickname, id: uuidv4(), timestamp: Date.now() };
    room.allReactions.push(payload);

    io.to(socket.roomId).emit('reaction', payload);
    io.to(socket.roomId).emit('reaction-stats', room.reactionStats);
    io.to(socket.roomId).emit('focus-update', room.focusTimeline);
  });

  socket.on('chat', ({ message }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;

    const trimmed = (message || '').trim().slice(0, 200);
    if (!trimmed) return;

    const nickname = socket.nickname || '익명';
    const payload = { message: trimmed, nickname, id: uuidv4(), timestamp: Date.now() };

    room.recentChats.push(payload);
    room.allChats.push(payload);
    if (room.recentChats.length > 50) room.recentChats.shift();

    io.to(socket.roomId).emit('chat', payload);
    io.to(socket.roomId).emit('wordcloud-update', room.allChats);
  });

  /* 투표 */
  socket.on('create-poll', ({ question, options }) => {
    if (!socket.isPresenter) return;
    const room = rooms.get(socket.roomId);
    if (!room) return;

    const opts = (options || []).map((t) => ({ text: t.trim(), votes: 0 })).filter((o) => o.text);
    if (!question?.trim() || opts.length < 2) return;

    room.poll = {
      id: uuidv4(),
      question: question.trim(),
      options: opts,
      voters: new Set(),
      active: true,
      createdAt: Date.now(),
    };
    broadcastState(socket.roomId);
  });

  socket.on('close-poll', () => {
    if (!socket.isPresenter) return;
    const room = rooms.get(socket.roomId);
    if (!room?.poll) return;

    room.poll.active = false;
    room.allPolls.push({
      id: room.poll.id,
      question: room.poll.question,
      options: room.poll.options.map((o) => ({ text: o.text, votes: o.votes })),
      closedAt: Date.now(),
    });
    broadcastState(socket.roomId);
  });

  socket.on('vote-poll', ({ optionIndex }) => {
    const room = rooms.get(socket.roomId);
    if (!room?.poll?.active) return;
    if (room.poll.voters.has(socket.id)) return;

    const idx = Number(optionIndex);
    if (idx < 0 || idx >= room.poll.options.length) return;

    room.poll.voters.add(socket.id);
    room.poll.options[idx].votes += 1;
    broadcastState(socket.roomId);
  });

  /* 질문 큐 */
  socket.on('submit-question', ({ text }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;

    const trimmed = (text || '').trim().slice(0, 300);
    if (!trimmed) return;

    const q = {
      id: uuidv4(),
      text: trimmed,
      nickname: socket.nickname || '익명',
      timestamp: Date.now(),
      answered: false,
    };
    room.questions.push(q);
    broadcastState(socket.roomId);
    io.to(socket.roomId).emit('new-question', { nickname: q.nickname, text: q.text });
  });

  socket.on('resolve-question', ({ questionId }) => {
    if (!socket.isPresenter) return;
    const room = rooms.get(socket.roomId);
    if (!room) return;

    const q = room.questions.find((x) => x.id === questionId);
    if (q) q.answered = true;
    broadcastState(socket.roomId);
  });

  /* 슬라이드 요청 */
  socket.on('slide-request', ({ direction }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    if (direction === 'next') room.slideRequests.next += 1;
    else if (direction === 'prev') room.slideRequests.prev += 1;
    io.to(socket.roomId).emit('slide-request-update', { ...room.slideRequests });
  });

  socket.on('reset-slide-requests', () => {
    if (!socket.isPresenter) return;
    const room = rooms.get(socket.roomId);
    if (!room) return;
    room.slideRequests = { next: 0, prev: 0 };
    io.to(socket.roomId).emit('slide-request-update', { ...room.slideRequests });
  });

  socket.on('get-session-data', (callback) => {
    if (!socket.isPresenter) return;
    const room = rooms.get(socket.roomId);
    if (!room) return;
    callback?.({
      roomId: room.id,
      title: room.title,
      chats: room.allChats,
      reactions: room.allReactions,
      questions: room.questions,
      polls: room.allPolls,
      reactionStats: room.reactionStats,
      focusTimeline: room.focusTimeline,
      slideRequests: room.slideRequests,
      participantCount: room.participants.size,
      createdAt: room.createdAt,
    });
  });

  socket.on('play-video', ({ url, startSec, endSec }, callback) => {
    const room = rooms.get(socket.roomId);
    if (!room) { callback?.({ ok: false }); return; }
    io.to(socket.roomId).emit('play-video', { url, startSec: Number(startSec) || 0, endSec: Number(endSec) || 60 });
    callback?.({ ok: true });
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.participants.delete(socket.id);
    io.to(roomId).emit('participant-count', room.participants.size);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const lanIp = getLanIp();
  console.log(`슬라이드 연수 서버: http://localhost:${PORT}`);
  if (lanIp) console.log(`모바일 참여 (같은 Wi-Fi): http://${lanIp}:${PORT}`);
});
