begin;
-- Fail atomically instead of queuing indefinitely behind operational writers.
set local lock_timeout = '2s';
set local statement_timeout = '30s';
alter table public.transacciones add constraint libro_transaccion_propietario unique(usuario_id,id,tarjeta_id);
-- Expansion only: no hooks on current tables and no active balance writer.
create table public.libro_aperturas (
 id uuid primary key default gen_random_uuid(), usuario_id uuid not null references public.usuarios(id),
 tarjeta_id uuid not null, moneda text not null, tipo_producto text not null,
 saldo_inicial numeric check(saldo_inicial is null or saldo_inicial::text not in ('NaN','Infinity','-Infinity')),
 solicitud_id uuid not null, created_at timestamptz not null default clock_timestamp(),
 modo text not null default 'ensayo' check(modo='ensayo'), fuente text not null default 'saldo_legacy_no_conciliado' check(fuente='saldo_legacy_no_conciliado'),
 unique(usuario_id,solicitud_id), unique(usuario_id,id), unique(usuario_id,id,tarjeta_id),
 foreign key(usuario_id,tarjeta_id,moneda,tipo_producto) references public.tarjetas(usuario_id,id,moneda,tipo_producto)
);
create table public.libro_operaciones (
 id uuid primary key default gen_random_uuid(), usuario_id uuid not null, apertura_id uuid not null,
 tarjeta_id uuid not null, tipo text not null check(tipo in ('apertura','gasto')), transaccion_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 check((tipo='apertura')=(transaccion_id is null)),
 foreign key(usuario_id,apertura_id,tarjeta_id) references public.libro_aperturas(usuario_id,id,tarjeta_id),
 foreign key(usuario_id,transaccion_id,tarjeta_id) references public.transacciones(usuario_id,id,tarjeta_id),
 unique(usuario_id,apertura_id,id), unique(apertura_id,transaccion_id)
);
create unique index libro_una_apertura on public.libro_operaciones(apertura_id) where tipo='apertura';
create table public.libro_apuntes (
 id uuid primary key default gen_random_uuid(), usuario_id uuid not null, apertura_id uuid not null, operacion_id uuid not null,
 importe numeric not null check(importe::text not in ('NaN','Infinity','-Infinity')),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(usuario_id,apertura_id,operacion_id) references public.libro_operaciones(usuario_id,apertura_id,id),
 unique(operacion_id)
);
create table public.libro_historicos_incluidos (
 usuario_id uuid not null, apertura_id uuid not null, transaccion_id uuid not null, tarjeta_id uuid not null,
 monto_cuenta_snapshot numeric,
 primary key(apertura_id,transaccion_id),
 foreign key(usuario_id,apertura_id,tarjeta_id) references public.libro_aperturas(usuario_id,id,tarjeta_id),
 foreign key(usuario_id,transaccion_id,tarjeta_id) references public.transacciones(usuario_id,id,tarjeta_id)
);
-- Child-side indexes bound FK probes when old rows/accounts are updated or deleted.
create index libro_apuntes_apertura on public.libro_apuntes(apertura_id);
create index libro_aperturas_cuenta on public.libro_aperturas(usuario_id,tarjeta_id,moneda,tipo_producto);
create index libro_operaciones_transaccion on public.libro_operaciones(usuario_id,transaccion_id,tarjeta_id);
create index libro_historicos_transaccion on public.libro_historicos_incluidos(usuario_id,transaccion_id,tarjeta_id);
create function abaco_privado.libro_inmutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Libro de ensayo inmutable; preparar otro ensayo' using errcode='42501'; end $$;
revoke all on function abaco_privado.libro_inmutable() from public,anon,authenticated,service_role;
do $$ declare tabla text; begin
 foreach tabla in array array['libro_aperturas','libro_operaciones','libro_apuntes','libro_historicos_incluidos'] loop
  execute format('alter table public.%I enable row level security',tabla);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',tabla);
  execute format('grant select on public.%I to authenticated',tabla);
  execute format('create policy propietario on public.%I for select to authenticated using(usuario_id=auth.uid())',tabla);
  execute format('create policy mfa on public.%I as restrictive for all to authenticated using((select public.acceso_protegido())) with check((select public.acceso_protegido()))',tabla);
  execute format('create trigger libro_inmutable before update or delete on public.%I for each row execute function abaco_privado.libro_inmutable()',tabla);
 end loop;
end $$;
create view public.libro_saldos_ensayo with(security_invoker=true) as
 select a.id as apertura_id,a.usuario_id,a.tarjeta_id,a.moneda,a.tipo_producto,a.modo,a.fuente,a.saldo_inicial,
 case when a.saldo_inicial is null then null else coalesce((select sum(p.importe) from public.libro_apuntes p where p.apertura_id=a.id),0) end as saldo_reconstruido
 from public.libro_aperturas a;
revoke all on public.libro_saldos_ensayo from public,anon,authenticated,service_role;
grant select on public.libro_saldos_ensayo to authenticated;

-- Operator-only rehearsal, not an Auth/API RPC or an activation switch.
create function abaco_privado.preparar_apertura_ensayo(p_usuario uuid,p_cuenta uuid,p_solicitud uuid,p_confirmacion text)
returns uuid language plpgsql security definer set search_path='' as $$
declare cuenta public.tarjetas; existente public.libro_aperturas; apertura uuid; operacion uuid;
begin
 if p_confirmacion is distinct from 'ensayo-sin-activacion' or p_solicitud is null then raise exception 'Confirmacion de ensayo requerida' using errcode='22023'; end if;
 perform abaco_privado.bloquear_operaciones_usuario(p_usuario);
 select * into existente from public.libro_aperturas where usuario_id=p_usuario and solicitud_id=p_solicitud;
 if found then
  if existente.tarjeta_id is distinct from p_cuenta then raise exception 'Solicitud usada con otra cuenta' using errcode='23505'; end if;
  return existente.id;
 end if;
 select * into cuenta from public.tarjetas where usuario_id=p_usuario and id=p_cuenta for update;
 if not found then raise exception 'Cuenta no autorizada' using errcode='42501'; end if;
 insert into public.libro_aperturas(usuario_id,tarjeta_id,moneda,tipo_producto,saldo_inicial,solicitud_id)
 values(p_usuario,cuenta.id,cuenta.moneda,cuenta.tipo_producto,cuenta.saldo_actual,p_solicitud) returning id into apertura;
 insert into public.libro_historicos_incluidos(usuario_id,apertura_id,transaccion_id,tarjeta_id,monto_cuenta_snapshot)
 select p_usuario,apertura,id,tarjeta_id,monto_cuenta from public.transacciones where usuario_id=p_usuario and tarjeta_id=p_cuenta and estado_revision='confirmado';
 insert into public.libro_operaciones(usuario_id,apertura_id,tarjeta_id,tipo) values(p_usuario,apertura,p_cuenta,'apertura') returning id into operacion;
 if cuenta.saldo_actual is not null then
  insert into public.libro_apuntes(usuario_id,apertura_id,operacion_id,importe) values(p_usuario,apertura,operacion,cuenta.saldo_actual);
 end if;
 return apertura;
end $$;
revoke all on function abaco_privado.preparar_apertura_ensayo(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;

-- Explicit mirror of an already-confirmed current-engine expense. Never writes tarjetas.
create function abaco_privado.reflejar_gasto_ensayo(p_apertura uuid,p_transaccion uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.libro_aperturas; gasto public.transacciones; op uuid;
begin
 select * into a from public.libro_aperturas where id=p_apertura;
 if not found then raise exception 'Ensayo inexistente' using errcode='22023'; end if;
 perform abaco_privado.bloquear_operaciones_usuario(a.usuario_id);
 perform 1 from public.tarjetas where id=a.tarjeta_id for update;
 if exists(select 1 from public.libro_historicos_incluidos where apertura_id=a.id and transaccion_id=p_transaccion) then
  raise exception 'Historico incluido en apertura; no descontar otra vez' using errcode='23505'; end if;
 select * into gasto from public.transacciones where id=p_transaccion and usuario_id=a.usuario_id and tarjeta_id=a.tarjeta_id and estado_revision='confirmado';
 if not found or gasto.monto_cuenta is null then raise exception 'Gasto no autorizado o no confirmado' using errcode='42501'; end if;
 select id into op from public.libro_operaciones where apertura_id=a.id and transaccion_id=gasto.id;
 if found then return op; end if;
 insert into public.libro_operaciones(usuario_id,apertura_id,tarjeta_id,tipo,transaccion_id) values(a.usuario_id,a.id,a.tarjeta_id,'gasto',gasto.id) returning id into op;
 insert into public.libro_apuntes(usuario_id,apertura_id,operacion_id,importe)
 values(a.usuario_id,a.id,op,case when a.tipo_producto='cuenta_corriente' then -gasto.monto_cuenta else gasto.monto_cuenta end);
 return op;
end $$;
revoke all on function abaco_privado.reflejar_gasto_ensayo(uuid,uuid) from public,anon,authenticated,service_role;

create function abaco_privado.comprobar_ensayo(p_apertura uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare a public.libro_aperturas; saldo numeric;
begin
 select * into a from public.libro_aperturas where id=p_apertura;
 if not found then return false; end if;
 perform abaco_privado.bloquear_operaciones_usuario(a.usuario_id);
 perform 1 from public.tarjetas where id=a.tarjeta_id for update;
 select saldo_reconstruido into saldo from public.libro_saldos_ensayo where apertura_id=a.id;
 return exists(select 1 from public.tarjetas where id=a.tarjeta_id and usuario_id=a.usuario_id and moneda=a.moneda and tipo_producto=a.tipo_producto and saldo_actual is not distinct from saldo)
 and (select count(*) from public.libro_operaciones where apertura_id=a.id and tipo='apertura')=1
 and not exists(
  select 1 from public.libro_operaciones o left join public.libro_apuntes p on p.operacion_id=o.id
  where o.apertura_id=a.id and o.tipo='apertura' and
  ((a.saldo_inicial is null and p.id is not null) or
   (a.saldo_inicial is not null and (p.id is null or p.importe is distinct from a.saldo_inicial))))
 and not exists(
  select 1 from public.libro_operaciones o
  left join public.libro_apuntes p on p.operacion_id=o.id
  left join public.transacciones t on t.id=o.transaccion_id
  where o.apertura_id=a.id and o.tipo='gasto' and
   (p.id is null or t.id is null or t.usuario_id<>a.usuario_id or t.tarjeta_id<>a.tarjeta_id
    or t.estado_revision<>'confirmado' or t.monto_cuenta is null
    or p.importe is distinct from case when a.tipo_producto='cuenta_corriente' then -t.monto_cuenta else t.monto_cuenta end
    or exists(select 1 from public.libro_historicos_incluidos h where h.apertura_id=a.id and h.transaccion_id=t.id)))
 and not exists(
  select 1 from public.transacciones t where t.usuario_id=a.usuario_id and t.tarjeta_id=a.tarjeta_id and t.estado_revision='confirmado'
  and not exists(select 1 from public.libro_historicos_incluidos h where h.apertura_id=a.id and h.transaccion_id=t.id)
  and not exists(select 1 from public.libro_operaciones o where o.apertura_id=a.id and o.transaccion_id=t.id))
 and not exists(select 1 from public.libro_historicos_incluidos h left join public.transacciones t on t.id=h.transaccion_id
  where h.apertura_id=a.id and (t.id is null or t.estado_revision<>'confirmado' or t.usuario_id<>a.usuario_id or t.tarjeta_id<>a.tarjeta_id or t.monto_cuenta is distinct from h.monto_cuenta_snapshot));
end $$;
revoke all on function abaco_privado.comprobar_ensayo(uuid) from public,anon,authenticated,service_role;
commit;
