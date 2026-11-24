
create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
insert into public.usuarios(id,email) values('00000000-0000-4000-8000-000000000003','heredado@test.invalid');
insert into auth.users select id,now() from public.usuarios;
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,aal text default 'aal1',factor_id uuid);
insert into auth.sessions(id,user_id) values ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000003');
create table auth.mfa_factors(id uuid primary key,user_id uuid references auth.users,status text,factor_type text default 'totp');
insert into auth.mfa_factors(id,user_id,status) values(gen_random_uuid(),'00000000-0000-4000-8000-000000000003','verified');
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create table public.metas_ahorro(id uuid primary key,usuario_id uuid);
create table public.movimientos_fijos(id uuid primary key,usuario_id uuid);
create table public.logs(id uuid primary key,evento text);
create table public.regex_rules(id uuid primary key default gen_random_uuid(),version integer,activa boolean);
create function public.version_global_regex_rules() returns integer language sql stable as $$ select coalesce(sum(version),0)::integer from public.regex_rules where activa $$;
create function public.get_regex_version_global() returns bigint language sql stable as $$ select coalesce(sum(version),0) from public.regex_rules where activa $$;
update usuarios set rol='admin' where id='00000000-0000-4000-8000-000000000002';
insert into public.logs values(gen_random_uuid(),'privado');
insert into public.regex_rules(version,activa) values(1,true);
do $$ declare tabla text; begin
foreach tabla in array array['tarjetas','categorias','transacciones','compras_cuotas','metas_ahorro','movimientos_fijos'] loop
 execute format('alter table public.%I enable row level security',tabla);
 execute format('create policy propio on public.%I for all to authenticated using(usuario_id=auth.uid())',tabla);
 execute format('grant select on public.%I to authenticated',tabla);
end loop;
end $$;
grant update on tarjetas to authenticated;
alter table logs enable row level security;
create policy admin_logs on logs for select to authenticated using(exists(select 1 from usuarios where id=auth.uid() and rol='admin'));
grant select on logs to authenticated;
alter table regex_rules enable row level security;
alter table tasas_cambio enable row level security;
create policy lectura on regex_rules for select using(true);
create policy lectura on tasas_cambio for select using(true);
create policy admin_reglas on regex_rules for all using(exists(select 1 from usuarios where id=auth.uid() and rol='admin'));
create policy admin_tasas on tasas_cambio for all using(exists(select 1 from usuarios where id=auth.uid() and rol='admin'));
grant all on regex_rules,tasas_cambio to authenticated;
