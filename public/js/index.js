const slideUrlInput = document.getElementById('slideUrl');
const canvaEmbedInput = document.getElementById('canvaEmbed');
const titleInput = document.getElementById('title');
const startBtn = document.getElementById('startBtn');
const errorMsg = document.getElementById('errorMsg');
const networkHint = document.getElementById('networkHint');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

let activeTab = 'url';

tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === activeTab));
    tabPanels.forEach((p) => p.classList.toggle('active', p.id === `tab-${activeTab}`));
  });
});

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function hideError() {
  errorMsg.classList.add('hidden');
}

function getSlideInput() {
  if (activeTab === 'canva') {
    return canvaEmbedInput.value.trim();
  }
  return slideUrlInput.value.trim();
}

async function loadNetworkHint() {
  try {
    const [netRes, cfgRes] = await Promise.all([
      fetch('/api/network'),
      fetch('/api/config'),
    ]);
    const net = await netRes.json();
    const cfg = await cfgRes.json();
    const parts = [];
    if (net.lanIp) parts.push(`모바일: http://${net.lanIp}:${net.port}`);
    if (cfg.supabaseEnabled) parts.push('☁️ Supabase 연결됨');
    else parts.push('💻 로컬 Socket.io 모드 (Supabase URL 설정 시 클라우드 배포 가능)');
    networkHint.textContent = parts.join(' · ');
  } catch { /* ignore */ }
}

startBtn.addEventListener('click', async () => {
  const slideUrl = getSlideInput();
  const title = titleInput.value.trim();

  if (!slideUrl) {
    showError(activeTab === 'canva' ? '캔바 Embed HTML 코드를 붙여넣어주세요.' : '슬라이드 URL을 입력해주세요.');
    return;
  }

  hideError();
  startBtn.disabled = true;
  startBtn.textContent = '준비 중...';

  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slideUrl, title }),
    });

    const data = await res.json();
    if (!res.ok) {
      showError(data.error || '연수 생성에 실패했습니다.');
      return;
    }

    window.location.href = `/present.html?room=${data.roomId}`;
  } catch {
    showError('서버에 연결할 수 없습니다.');
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = '▶ 연수 시작';
  }
});

[slideUrlInput, canvaEmbedInput, titleInput].forEach((el) => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) startBtn.click();
  });
});

loadNetworkHint();
