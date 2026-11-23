-- Local SQL simulation ONLY. Never run this file in Supabase hosted.
-- The isolated test runner refuses every host except 127.0.0.1 and its own port.
do $$ declare nombre text; begin
 foreach nombre in array array['anon','authenticated','service_role','supabase_auth_admin'] loop
  if not exists(select 1 from pg_roles where rolname=nombre) then execute format('create role %I',nombre);end if;
 end loop;
end $$;
alter role service_role bypassrls;
create schema auth authorization supabase_auth_admin;
set role supabase_auth_admin;
create type auth.aal_level as enum('aal1','aal2','aal3');
create type auth.factor_status as enum('unverified','verified');
create type auth.factor_type as enum('totp','phone','webauthn');
create table auth.users(id uuid primary key,email text not null unique,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade,aal auth.aal_level default 'aal1',factor_id uuid);
create table auth.mfa_factors(id uuid primary key,user_id uuid references auth.users on delete cascade,status auth.factor_status,factor_type auth.factor_type);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
reset role;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on all functions in schema auth to anon,authenticated,service_role;
