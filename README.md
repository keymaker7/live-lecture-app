# 슬라이드 연수 (Slides Live)

실시간 슬라이드 연수 플랫폼 — QR 참여, 이모지 반응, 채팅, 투표, 질문 큐, 워드클라우드, 타이머, 집중도 차트

기존 [live-lecture-app](https://github.com/keymaker7/live-lecture-app) 기능을 확장하고 파스텔 UI로 재디자인한 버전입니다.

## 로컬 실행

```bash
npm install
npm start
```

→ http://localhost:3000

## Supabase 설정 (선택, 배포 시 권장)

1. [Supabase 대시보드](https://supabase.com/dashboard) → Project Settings → API
2. **Project URL** 복사 (예: `https://xxxxx.supabase.co`)
3. `.env` 파일 설정:

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=sb_publishable_...
```

> URL 없이 키만 있으면 Socket.io 로컬 모드로 동작합니다.

## 배포 (Render — 권장)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/keymaker7/live-lecture-app)

1. 위 버튼 클릭 → Render 로그인 → Deploy
2. 환경 변수 입력:
   - `SUPABASE_URL` = Supabase 대시보드 Project URL
   - `SUPABASE_ANON_KEY` = `sb_publishable_...`
3. 배포 완료 후 `https://slides-live-xxxx.onrender.com` 주소로 접속

> GitHub 푸시는 완료됨: https://github.com/keymaker7/live-lecture-app

## GitHub 푸시

```bash
cd slides
git init
git add .
git commit -m "파스텔 UI + 고도화 기능"
git remote add origin https://github.com/keymaker7/live-lecture-app.git
git push -u origin main --force   # 기존 Next.js 대체 시
```

## 기능

- 구글 슬라이드 / 캔바 임베드
- QR 참여, 실시간 반응·채팅
- 실시간 투표, 질문 큐, 슬라이드 요청
- 워드클라우드, 집중도 차트, 타이머
- 세션 localStorage 저장·검색

## 라이선스

MIT
