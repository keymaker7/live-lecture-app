-- 2026-10-01 · 연수 정보를 DB에 저장한다
--
-- 배경: 연수(room)가 서버 메모리(lib/room-store.ts 의 globalThis Map)에만 있었다.
--       Vercel 은 요청마다 다른 서버가 받을 수 있고, 한동안 안 쓰면 서버가 사라진다.
--       그래서 만든 컴퓨터(브라우저 사본)에서만 열리고, 다른 컴퓨터·참가자 QR 은
--       「연수를 찾을 수 없습니다」가 떴다.
--
-- 표는 잠그고(공개 키로 직접 읽기·쓰기 불가), 함수 두 개로만 다룬다.
--   create_lecture_room : 연수 하나 만들기
--   get_lecture_room    : id 하나로 연수 하나 읽기 — 목록 훑기는 안 된다
-- 앱 서버는 공개(anon) 키만 갖고 있어서 함수는 SECURITY DEFINER 로 둔다.

CREATE TABLE IF NOT EXISTS public.lecture_rooms (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}$'),
  title text NOT NULL DEFAULT '연수' CHECK (char_length(title) <= 200),
  slide_url text NOT NULL CHECK (char_length(slide_url) <= 2000),
  slide_type text NOT NULL CHECK (char_length(slide_type) <= 40),
  embed_url text CHECK (embed_url IS NULL OR char_length(embed_url) <= 2000),
  canva_design_id text CHECK (canva_design_id IS NULL OR char_length(canva_design_id) <= 200),
  canva_view_url text CHECK (canva_view_url IS NULL OR char_length(canva_view_url) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lecture_rooms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lecture_rooms FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_lecture_room(
  p_id text, p_title text, p_slide_url text, p_slide_type text,
  p_embed_url text, p_canva_design_id text, p_canva_view_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO lecture_rooms (id, title, slide_url, slide_type, embed_url, canva_design_id, canva_view_url)
  VALUES (p_id, coalesce(nullif(p_title, ''), '연수'), p_slide_url, p_slide_type,
          p_embed_url, p_canva_design_id, p_canva_view_url);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_lecture_room(p_id text)
RETURNS SETOF public.lecture_rooms
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM lecture_rooms WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.create_lecture_room(text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_lecture_room(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_lecture_room(text, text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_lecture_room(text) TO anon, authenticated;
