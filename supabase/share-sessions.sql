-- ============================================================
-- 버니어 척척박사 ② — 모둠 간 데이터 공유(공유 코드) 스키마
-- ※ 이 파일은 현재 Supabase 프로젝트에 "실제로 적용되어 동작 중"인 스키마다.
--   (2026-07-05 라이브 호출로 계약 확인 완료)
--
-- 보안 모델:
--   · share_sessions 는 RLS 활성 + 정책 0개 = anon 직접 접근 전면 차단
--   · anon 에게는 아래 두 SECURITY DEFINER 함수만 개방
--       create_share_session(jsonb) -> text   업로드 후 6자리 코드 발급
--       get_share_session(text)     -> jsonb  코드로 payload 조회
--   · 따라서 publishable/anon key가 공개돼도 임의 조회·열거·삭제가 불가능하다.
--
-- 클라이언트가 의존하는 계약(중요):
--   · get_share_session 성공 시 → payload(jsonb) 를 "그대로" 반환
--   · 없거나 만료 시        → raise exception (HTTP 400, code P0001)
--                              ※ 오타와 만료를 구분하지 않는다(맨 아래 선택 개선 참고)
-- ============================================================

-- ---------- 1) 테이블 ----------
create table if not exists public.share_sessions (
  id          uuid primary key default gen_random_uuid(),
  code        text        not null unique,
  payload     jsonb       not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days')
);

create index if not exists idx_share_sessions_code    on public.share_sessions (code);
create index if not exists idx_share_sessions_expires on public.share_sessions (expires_at);

-- RLS 활성화 + 정책 0개 = anon의 테이블 직접 접근 전면 차단
alter table public.share_sessions enable row level security;

-- ---------- 2) 코드 생성기 (헷갈리는 0/O/1/I/L 제외, 6자리) ----------
create or replace function public.gen_share_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  result text := '';
  i int;
begin
  for i in 1..6 loop
    result := result || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
  end loop;
  return result;
end;
$$;

-- ---------- 3) 데이터 업로드 → 코드 반환 ----------
create or replace function public.create_share_session(p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_try  int := 0;
begin
  -- 과도한 용량 차단 (약 200KB)
  if pg_column_size(p_payload) > 200000 then
    raise exception '데이터 용량이 너무 큽니다.';
  end if;

  loop
    v_try := v_try + 1;
    v_code := gen_share_code();
    begin
      insert into share_sessions (code, payload) values (v_code, p_payload);
      return v_code;
    exception when unique_violation then
      if v_try >= 10 then
        raise exception '코드 생성에 실패했습니다. 다시 시도해 주세요.';
      end if;
    end;
  end loop;
end;
$$;

-- ---------- 4) 코드로 데이터 조회 ----------
-- 대소문자·공백은 서버에서 정규화하므로 클라이언트 입력이 소문자여도 동작한다.
create or replace function public.get_share_session(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  select payload into v_payload
  from share_sessions
  where code = upper(trim(p_code))
    and expires_at > now();

  if v_payload is null then
    raise exception '코드를 찾을 수 없거나 사용 기간이 지났습니다.';
  end if;

  return v_payload;
end;
$$;

-- ---------- 5) 만료 데이터 정리 ----------
create or replace function public.cleanup_share_sessions()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.share_sessions where expires_at < now();
$$;

-- ---------- 6) 권한: 딱 두 함수만 anon에게 개방 ----------
revoke execute on function public.gen_share_code()            from public, anon, authenticated;
revoke execute on function public.cleanup_share_sessions()    from public, anon, authenticated;

grant  execute on function public.create_share_session(jsonb) to anon, authenticated;
grant  execute on function public.get_share_session(text)     to anon, authenticated;

-- ---------- 7) (선택) 자동 정리 ----------
-- Dashboard → Database → Extensions 에서 pg_cron 활성화 후:
-- select cron.schedule('cleanup-share-sessions', '0 3 * * *',
--   $$ select public.cleanup_share_sessions(); $$);

-- ============================================================
-- (선택 개선) 오타와 만료를 구분해 안내하고 싶다면 아래로 교체하세요.
-- 클라이언트는 두 형태를 모두 처리하도록 되어 있어 그대로 동작합니다.
-- ------------------------------------------------------------
-- create or replace function public.get_share_session(p_code text)
-- returns jsonb language plpgsql security definer set search_path = public as $$
-- declare r share_sessions%rowtype;
-- begin
--   select * into r from share_sessions where code = upper(trim(coalesce(p_code,'')));
--   if not found then return jsonb_build_object('status','not_found'); end if;
--   if r.expires_at < now() then return jsonb_build_object('status','expired'); end if;
--   return jsonb_build_object('status','ok','payload', r.payload);
-- end; $$;
-- ============================================================
