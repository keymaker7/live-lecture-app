-- 2026-10-16 · 게임 결과 저장 (live-lecture 캐릭터 광장 P4, 설계서 §6-4)
--
-- 운영 DB 적용: Loki 리뷰 통과 → Ironman 확인 뒤에만. 적용한 다음 Vercel 환경 변수 LL_RESULTS_DB=1 을 켠다.
-- (켜기 전엔 앱이 이 함수들을 부르지 않는다 — 순서를 거꾸로 해도 화면은 안 깨진다.)
--
-- 발표자 비밀값(host key): 연수를 만든 브라우저에서 만든 32자리 hex. DB 에는 sha256 해시만.
-- 표는 잠그고(공개 키로 직접 읽기·쓰기 불가) 함수 4개로만 다룬다. 기존 create_lecture_room 은 그대로 둔다
-- (배포 중 옛 화면이 부르는 함수 — 지우면 그 사이 연수 만들기가 깨진다).
--
--   create_lecture_room_v2(…, p_host_key_hash)  새 연수 + 비밀값 해시
--   claim_room_host(p_room, p_host_key_hash)     예전 연수: 해시가 비어 있을 때만 등록
--   record_game_result(p_room, p_host_key, p_payload)  비밀값이 맞을 때만 게임 1판 저장
--   get_room_results(p_room, p_host_key)         비밀값이 맞을 때만 읽기
--
-- 알고 있는 한계: 예전 연수는 방 id(참가 QR 에 있음)를 아는 사람이 먼저 claim 할 수 있다.
-- 그러면 진짜 발표자의 저장이 denied 가 되고 화면에 "저장 안 됨"이 뜬다(점수 진행·CSV 는 이 PC 에서 그대로 된다).

ALTER TABLE public.lecture_rooms
  ADD COLUMN IF NOT EXISTS host_key_hash text
  CHECK (host_key_hash IS NULL OR host_key_hash ~ '^[0-9a-f]{64}$');

CREATE TABLE IF NOT EXISTS public.lecture_game_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL REFERENCES public.lecture_rooms(id) ON DELETE CASCADE,
  game_id text NOT NULL CHECK (game_id ~ '^[0-9a-zA-Z_-]{1,64}$'),
  game_type text NOT NULL CHECK (game_type IN ('quiz', 'rps', 'run')),
  title text NOT NULL CHECK (char_length(title) <= 60),
  started_at timestamptz,
  ended_at timestamptz,
  -- 문제별 정답·참가 수, 참가자별 점수·정답 수·응답 시간(요약). 256KB 아래.
  results jsonb NOT NULL CHECK (octet_length(results::text) <= 262144),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, game_id)
);

CREATE INDEX IF NOT EXISTS lecture_game_results_room_idx ON public.lecture_game_results (room_id, ended_at);

ALTER TABLE public.lecture_game_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lecture_game_results FROM anon, authenticated;

-- 10/01 get_lecture_room 은 SELECT * 라 새 열(발표자 비밀값 해시)까지 anon 에게 준다 — 해시는 빼고 돌려준다(Loki 리뷰).
-- 이름·모양·권한은 그대로(앱 서버 room-store.getRoom 이 쓰는 열도 그대로).
CREATE OR REPLACE FUNCTION public.get_lecture_room(p_id text)
RETURNS SETOF public.lecture_rooms
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, title, slide_url, slide_type, embed_url, canva_design_id, canva_view_url, created_at, NULL::text
    FROM lecture_rooms WHERE id = p_id;
$$;

-- 비밀값 → 해시 (앱의 lib/realtime/sha256.ts 와 같은 값)
CREATE OR REPLACE FUNCTION public._lecture_host_hash(p_host_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p_host_key ~ '^[0-9a-f]{32}$'
              THEN encode(sha256(convert_to(p_host_key, 'UTF8')), 'hex') END;
$$;

CREATE OR REPLACE FUNCTION public.create_lecture_room_v2(
  p_id text, p_title text, p_slide_url text, p_slide_type text,
  p_embed_url text, p_canva_design_id text, p_canva_view_url text,
  p_host_key_hash text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_host_key_hash IS NOT NULL AND p_host_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid host key hash' USING ERRCODE = '22023';
  END IF;
  INSERT INTO lecture_rooms (id, title, slide_url, slide_type, embed_url, canva_design_id, canva_view_url, host_key_hash)
  VALUES (p_id, coalesce(nullif(p_title, ''), '연수'), p_slide_url, p_slide_type,
          p_embed_url, p_canva_design_id, p_canva_view_url, p_host_key_hash);
END;
$$;

-- 해시가 비어 있을 때만 등록. 이미 같은 해시면 true(다시 불러도 됨), 다른 해시면 false.
CREATE OR REPLACE FUNCTION public.claim_room_host(p_room text, p_host_key_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
BEGIN
  IF p_host_key_hash IS NULL OR p_host_key_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  UPDATE lecture_rooms SET host_key_hash = p_host_key_hash
   WHERE id = p_room AND host_key_hash IS NULL;
  IF FOUND THEN
    RETURN true;
  END IF;
  SELECT host_key_hash INTO v_hash FROM lecture_rooms WHERE id = p_room;
  RETURN v_hash IS NOT NULL AND v_hash = p_host_key_hash;
END;
$$;

-- 돌려주는 글자: ok · duplicate(같은 게임 다시 — 재시도) · unclaimed(비밀값 미등록 → claim 뒤 다시)
--               denied · no-room · invalid · full(한 연수 300판 넘음)
CREATE OR REPLACE FUNCTION public.record_game_result(p_room text, p_host_key text, p_payload jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_given text := _lecture_host_hash(p_host_key);
  v_id text;
  v_type text;
  v_title text;
  v_count int;
BEGIN
  SELECT host_key_hash INTO v_hash FROM lecture_rooms WHERE id = p_room;
  IF NOT FOUND THEN
    RETURN 'no-room';
  END IF;
  IF v_hash IS NULL THEN
    RETURN 'unclaimed';
  END IF;
  IF v_given IS NULL OR v_given <> v_hash THEN
    RETURN 'denied';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR octet_length(p_payload::text) > 262144 THEN
    RETURN 'invalid';
  END IF;
  v_id := p_payload->>'id';
  v_type := p_payload->>'type';
  v_title := left(coalesce(p_payload->>'title', ''), 60);
  IF v_id IS NULL OR v_id !~ '^[0-9a-zA-Z_-]{1,64}$' OR v_type NOT IN ('quiz', 'rps', 'run')
     OR jsonb_typeof(p_payload->'players') IS DISTINCT FROM 'array' THEN
    RETURN 'invalid';
  END IF;

  SELECT count(*) INTO v_count FROM lecture_game_results WHERE room_id = p_room;
  IF v_count >= 300 THEN
    RETURN 'full';
  END IF;

  INSERT INTO lecture_game_results (room_id, game_id, game_type, title, started_at, ended_at, results)
  VALUES (
    p_room, v_id, v_type, v_title,
    -- 시각은 ms. 2000~2100년 밖이면 비운다(엉뚱한 큰 수로 timestamp 범위 예외가 나지 않게)
    CASE WHEN jsonb_typeof(p_payload->'startedAt') = 'number'
              AND (p_payload->>'startedAt')::double precision BETWEEN 946684800000 AND 4102444800000
         THEN to_timestamp((p_payload->>'startedAt')::double precision / 1000) END,
    CASE WHEN jsonb_typeof(p_payload->'endedAt') = 'number'
              AND (p_payload->>'endedAt')::double precision BETWEEN 946684800000 AND 4102444800000
         THEN to_timestamp((p_payload->>'endedAt')::double precision / 1000) END,
    p_payload
  )
  ON CONFLICT (room_id, game_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;
  RETURN 'ok';
END;
$$;

-- {"ok": true, "games": [묶음, …]} (끝난 순) / {"ok": false}
CREATE OR REPLACE FUNCTION public.get_room_results(p_room text, p_host_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_given text := _lecture_host_hash(p_host_key);
BEGIN
  SELECT host_key_hash INTO v_hash FROM lecture_rooms WHERE id = p_room;
  IF v_hash IS NULL OR v_given IS NULL OR v_given <> v_hash THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  RETURN jsonb_build_object('ok', true, 'games', coalesce((
    SELECT jsonb_agg(results ORDER BY ended_at NULLS LAST, created_at)
      FROM lecture_game_results WHERE room_id = p_room
  ), '[]'::jsonb));
END;
$$;

-- 수파베이스는 새 함수에 anon 실행 권한을 기본으로 준다(PUBLIC 과 별개) — 내부 함수는 역할에서도 직접 뺀다
REVOKE ALL ON FUNCTION public._lecture_host_hash(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_lecture_room_v2(text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_room_host(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_game_result(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_room_results(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_lecture_room_v2(text, text, text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_room_host(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_game_result(text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_room_results(text, text) TO anon, authenticated;
