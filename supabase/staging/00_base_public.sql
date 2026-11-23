-- STAGING ONLY: reconstructed from ABACO_CONTEXTO_CODEX.md, no production dump/data.
-- Run only on a confirmed empty disposable project, before migrations 001 -> 004.
-- Auth tables/functions must already be supplied by Supabase. Never recreate them hosted.
begin;
do $$
begin
  if current_setting('abaco.staging_confirmed',true) is distinct from 'empty-synthetic-only' then
    raise exception 'Staging must be explicitly confirmed in this session';
  end if;
  if to_regclass('public.usuarios') is not null or exists(select 1 from auth.users) then
    raise exception 'Base requires an empty project; refuses to overwrite profiles or Auth users';
  end if;
end $$;

create table public.usuarios (
 id uuid primary key default gen_random_uuid(), email text not null unique, nombre text,
 rol text default 'usuario' check(rol in ('usuario','tester','admin')),
 estado_suscripcion text default 'activa' check(estado_suscripcion in ('activa','vencida','beta')),
 fecha_vencimiento timestamptz, regla_presupuesto_activa boolean default false,
 created_at timestamptz default now(),
 constraint fk_usuarios_auth_user foreign key(id) references auth.users(id) on delete cascade
);
create table public.categorias (
 id uuid primary key default gen_random_uuid(), usuario_id uuid not null references public.usuarios on delete cascade,
 nombre text not null, icono text, es_por_defecto boolean default false, created_at timestamptz default now(),
 unique(usuario_id,nombre)
);
create table public.tarjetas (
 id uuid primary key default gen_random_uuid(), usuario_id uuid not null references public.usuarios on delete cascade,
 alias text not null, ultimos_digitos varchar not null,
 tipo_producto text not null check(tipo_producto in ('cuenta_corriente','linea_credito','credito_nacional','credito_internacional')),
 moneda text not null check(moneda in ('CLP','USD')), saldo_actual numeric default 0, cupo_maximo numeric,
 dia_corte integer check(dia_corte between 1 and 31), dia_pago integer check(dia_pago between 1 and 31),
 created_at timestamptz default now()
);
create table public.transacciones (
 id uuid primary key default gen_random_uuid(), usuario_id uuid not null references public.usuarios on delete cascade,
 tarjeta_id uuid not null references public.tarjetas on delete cascade,
 categoria_id uuid references public.categorias on delete set null,
 monto_original numeric not null, moneda_original text not null check(moneda_original in ('CLP','USD')),
 monto_clp numeric not null, comercio text not null, fecha timestamptz not null, origen text not null,
 sincronizado boolean default false, intentos_sync integer default 0, created_at timestamptz default now(),
 constraint transacciones_origen_check check(origen in ('regex_sms','regex_email','manual','ocr','fijo'))
);
create table public.compras_cuotas (
 id uuid primary key default gen_random_uuid(), usuario_id uuid not null references public.usuarios on delete cascade,
 transaccion_id uuid references public.transacciones on delete set null,
 tarjeta_id uuid not null references public.tarjetas on delete cascade,
 comercio text not null, monto_total numeric not null, num_cuotas integer not null check(num_cuotas>0),
 monto_cuota numeric not null, fecha_primera_cuota date not null, tasa_interes_mensual numeric,
 created_at timestamptz default now()
);
create table public.metas_ahorro (
 id uuid primary key default gen_random_uuid(),usuario_id uuid not null references public.usuarios on delete cascade,
 nombre text not null,monto_objetivo numeric not null,monto_actual numeric default 0,created_at timestamptz default now()
);
create table public.movimientos_fijos (
 id uuid primary key default gen_random_uuid(),usuario_id uuid not null references public.usuarios on delete cascade,
 nombre text not null,tipo text not null check(tipo in ('gasto','ingreso')),monto numeric not null,
 moneda text not null check(moneda in ('CLP','USD')),categoria_id uuid references public.categorias on delete set null,
 tarjeta_id uuid references public.tarjetas on delete set null,dia_cobro integer not null check(dia_cobro between 1 and 31),
 activo boolean default true,created_at timestamptz default now(),updated_at timestamptz default now(),
 es_suscripcion boolean default false
);
create table public.logs (
 id uuid primary key default gen_random_uuid(),nivel text not null check(nivel in ('info','warn','error')),
 evento text not null,detalle jsonb,created_at timestamptz default now()
);
create table public.regex_rules (
 id uuid primary key default gen_random_uuid(),banco_o_plataforma text not null,
 tipo_fuente text not null check(tipo_fuente in ('texto','sms','email')),patron text not null,
 version integer default 1,activa boolean default true,updated_at timestamptz default now()
);
create table public.tasas_cambio (
 moneda text primary key check(moneda in ('USD','EUR','UF')),valor numeric not null,
 fecha_actualizacion timestamptz default now()
);

do $$ declare tabla text; begin
 foreach tabla in array array['categorias','compras_cuotas','metas_ahorro','movimientos_fijos','tarjetas','transacciones'] loop
  execute format('alter table public.%I enable row level security',tabla);
  execute format('create policy propietario on public.%I for all using(auth.uid()=usuario_id)',tabla);
  execute format('grant select,insert,update,delete,references on public.%I to anon,authenticated',tabla);
 end loop;
 foreach tabla in array array['usuarios','logs','regex_rules','tasas_cambio'] loop
  execute format('alter table public.%I enable row level security',tabla);
 end loop;
end $$;
create policy perfil_lectura on public.usuarios for select using(auth.uid()=id);
create policy perfil_update on public.usuarios for update using(auth.uid()=id);
grant select,insert,update,references on public.usuarios to anon,authenticated;
create policy logs_admin on public.logs for select using(exists(select 1 from public.usuarios where id=auth.uid() and rol='admin'));
grant select on public.logs to authenticated;
create policy reglas_lectura on public.regex_rules for select using(true);
create policy reglas_admin on public.regex_rules for all using(exists(select 1 from public.usuarios where id=auth.uid() and rol='admin'));
create policy tasas_lectura on public.tasas_cambio for select using(true);
create policy tasas_admin on public.tasas_cambio for all using(exists(select 1 from public.usuarios where id=auth.uid() and rol='admin'));
grant select,insert,update,delete on public.regex_rules,public.tasas_cambio to anon,authenticated;
grant usage on schema public to anon,authenticated,service_role;
grant all on all tables in schema public to service_role;

create function public.actualizar_saldo_tarjeta() returns trigger language plpgsql as $$
declare tipo text; begin
 select tipo_producto into tipo from public.tarjetas where id=new.tarjeta_id;
 update public.tarjetas set saldo_actual=saldo_actual+case when tipo='cuenta_corriente' then -new.monto_original else new.monto_original end where id=new.tarjeta_id;
 return new;
end $$;
create trigger trigger_actualizar_saldo_tarjeta after insert on public.transacciones for each row execute function public.actualizar_saldo_tarjeta();
create function public.actualizar_updated_at_movimientos_fijos() returns trigger language plpgsql as $$
begin new.updated_at=now();return new;end $$;
create trigger trg_movimientos_fijos_updated_at before update on public.movimientos_fijos for each row execute function public.actualizar_updated_at_movimientos_fijos();
create function public.proteger_campos_suscripcion() returns trigger language plpgsql security definer as $$
begin
 if (new.estado_suscripcion is distinct from old.estado_suscripcion or new.fecha_vencimiento is distinct from old.fecha_vencimiento)
   and auth.role()<>'service_role' and not exists(select 1 from public.usuarios where id=auth.uid() and rol='admin') then
  raise exception 'Suscripcion protegida';
 end if;
 return new;
end $$;
create trigger trg_proteger_suscripcion before update on public.usuarios for each row execute function public.proteger_campos_suscripcion();
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.usuarios(id,email,nombre,rol,estado_suscripcion,regla_presupuesto_activa)
 values(new.id,new.email,coalesce(new.raw_user_meta_data->>'nombre',split_part(new.email,'@',1)),'usuario','activa',false)
 on conflict(id) do nothing;
 insert into public.categorias(usuario_id,nombre,icono,es_por_defecto)
 select new.id,nombre,icono,true from (values('comida','🍽️'),('transporte','🚗'),('entretencion','🎬'),('salud','🏥'),('hogar','🏠'),('suscripciones','📺'),('otros','📦')) as c(nombre,icono)
 on conflict(usuario_id,nombre) do nothing;
 insert into public.logs(nivel,evento,detalle) values('info','usuario_creado',jsonb_build_object('usuario_id',new.id));
 return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create function public.get_regex_version_global() returns bigint language sql stable as $$ select coalesce(sum(version),0) from public.regex_rules where activa=true $$;
create function public.version_global_regex_rules() returns integer language sql stable as $$ select coalesce(sum(version),0)::integer from public.regex_rules where activa=true $$;

create index on public.categorias(usuario_id);
create index on public.compras_cuotas(usuario_id);
create index on public.compras_cuotas(tarjeta_id);
create index on public.compras_cuotas(fecha_primera_cuota);
create index on public.movimientos_fijos(usuario_id);
create index on public.movimientos_fijos(activo);
create index on public.movimientos_fijos(dia_cobro);
create index on public.tarjetas(usuario_id);
create index on public.transacciones(usuario_id);
create index on public.transacciones(tarjeta_id);
create index on public.transacciones(fecha);
create index idx_transacciones_duplicados on public.transacciones(usuario_id,monto_original,comercio,fecha desc);
commit;
