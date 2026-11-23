begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- Install only in a drained write window. Never wait holding half of the old writer's locks.
lock table public.transacciones,public.tarjetas in access exclusive mode nowait;

do $$begin
 if not exists(select 1 from pg_roles where rolname='abaco_financiero') then
  create role abaco_financiero nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
 end if;
 if exists(select 1 from pg_roles where rolname='abaco_financiero' and
   (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then
  raise exception 'Rol financiero inseguro';
 end if;
 if pg_has_role('anon','abaco_financiero','MEMBER') or pg_has_role('authenticated','abaco_financiero','MEMBER')
   or pg_has_role('service_role','abaco_financiero','MEMBER') then raise exception 'Rol financiero heredado por API'; end if;
 if exists(select 1 from pg_auth_members where roleid='abaco_financiero'::regrole and member<>'postgres'::regrole)
   or exists(select 1 from pg_auth_members where member='abaco_financiero'::regrole) then
  raise exception 'Membresias financieras no revisadas';end if;
 -- An old SECURITY DEFINER function OR owner-executed view could expose the new privileges.
 -- Require a dedicated role with no pre-existing owned objects, also in other databases.
 if exists(select 1 from pg_shdepend where refclassid='pg_authid'::regclass
   and refobjid='abaco_financiero'::regrole and deptype='o') then
  raise exception 'Rol financiero ya posee objetos no revisados';end if;
end $$;
-- PostgreSQL 16+ role creators may initially have ADMIN without SET/INHERIT.
-- Required by the managed, non-superuser installer for ownership and ACL changes.
grant abaco_financiero to postgres with set true;
grant abaco_financiero to postgres with inherit true;
grant usage on schema public,abaco_privado to abaco_financiero;

create table abaco_privado.libro_control (
 singleton boolean primary key default true check(singleton),
 modo text not null check(modo in ('legacy','libro','pausado')),
 corte_id uuid unique, activado_at timestamptz,
 check((modo='legacy')=(corte_id is null))
);
insert into abaco_privado.libro_control(modo) values('legacy');
create table abaco_privado.libro_cuentas (
 tarjeta_id uuid primary key, usuario_id uuid not null, apertura_id uuid not null unique,
 corte_id uuid not null references abaco_privado.libro_control(corte_id),
 unique(usuario_id,tarjeta_id,apertura_id),
 foreign key(usuario_id,apertura_id,tarjeta_id) references public.libro_aperturas(usuario_id,id,tarjeta_id)
);
create table abaco_privado.libro_eventos_control (
 id uuid primary key default gen_random_uuid(), corte_id uuid not null references abaco_privado.libro_control(corte_id),
 evento text not null check(evento in ('activar','pausar','reconstruir','reanudar')),
 actor text not null default session_user, created_at timestamptz not null default clock_timestamp()
);
revoke all on abaco_privado.libro_control,abaco_privado.libro_cuentas,abaco_privado.libro_eventos_control from public,anon,authenticated,service_role;
alter table abaco_privado.libro_cuentas enable row level security;
create policy proyector on abaco_privado.libro_cuentas for select to abaco_financiero using(true);
grant select on abaco_privado.libro_cuentas to abaco_financiero;
create trigger libro_cuenta_inmutable before update or delete on abaco_privado.libro_cuentas
 for each row execute function abaco_privado.libro_inmutable();
create trigger libro_evento_inmutable before update or delete on abaco_privado.libro_eventos_control
 for each row execute function abaco_privado.libro_inmutable();

-- Preserve every rehearsal. Operational openings are NEW rows and never activate an old snapshot.
alter table public.libro_aperturas drop constraint libro_aperturas_modo_check,
 add constraint libro_aperturas_modo_check check(modo in ('ensayo','operativo'));
alter table public.libro_aperturas drop constraint libro_aperturas_fuente_check,
 add constraint libro_aperturas_fuente_check check(fuente in ('saldo_legacy_no_conciliado','alta_cuenta_no_conciliada'));
alter table public.libro_operaciones add column operativa boolean not null default false,
 add column secuencia bigint,
 add constraint libro_secuencia_operativa check((operativa and secuencia is not null and secuencia>0) or (not operativa and secuencia is null));
create unique index libro_gasto_operativo_unico on public.libro_operaciones(transaccion_id)
 where operativa and transaccion_id is not null;
create unique index libro_secuencia_por_apertura on public.libro_operaciones(apertura_id,secuencia) where operativa;

create table public.libro_proyecciones (
 tarjeta_id uuid primary key, usuario_id uuid not null, apertura_id uuid not null,
 saldo numeric check(saldo is null or saldo::text not in ('NaN','Infinity','-Infinity')),
 version bigint not null check(version>=1), actualizado_at timestamptz not null default clock_timestamp(),
 foreign key(usuario_id,tarjeta_id,apertura_id) references abaco_privado.libro_cuentas(usuario_id,tarjeta_id,apertura_id)
);
alter table public.libro_proyecciones enable row level security;
revoke all on public.libro_proyecciones from public,anon,authenticated,service_role;
grant select on public.libro_proyecciones to authenticated;
grant select,insert,update,delete on public.libro_proyecciones to abaco_financiero;
create policy propietario on public.libro_proyecciones for select to authenticated using(usuario_id=auth.uid());
create policy mfa on public.libro_proyecciones as restrictive for all to authenticated
 using((select public.acceso_protegido())) with check((select public.acceso_protegido()));
create policy proyector on public.libro_proyecciones to abaco_financiero using(true) with check(true);
grant select on public.tarjetas to abaco_financiero;
grant update(saldo_actual) on public.tarjetas to abaco_financiero;
create policy proyector on public.tarjetas to abaco_financiero using(true) with check(true);
do $$declare tabla text;begin
 foreach tabla in array array['libro_aperturas','libro_operaciones','libro_apuntes','libro_historicos_incluidos'] loop
  execute format('grant select on public.%I to abaco_financiero',tabla);
  execute format('create policy proyector on public.%I for select to abaco_financiero using(true)',tabla);
 end loop;
end $$;

create function abaco_privado.puerta_financiera() returns text
language plpgsql security definer set search_path='' as $$
declare estado text;begin
 select modo into strict estado from abaco_privado.libro_control where singleton for share;
 if estado='pausado' then raise exception 'Escritura financiera pausada' using errcode='55000'; end if;
 return estado;
end $$;
-- This lock precedes user/credential/event/account locks on every existing wrapper, including v1/v2.
create or replace function abaco_privado.bloquear_operaciones_usuario(p_usuario uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 -- Security management (especially revocation) must remain available during a financial pause.
 -- Hold the barrier before the user lock; receipt/account statement triggers reject new writes.
 perform 1 from abaco_privado.libro_control where singleton for share;
 if not found then raise exception 'Control financiero ausente';end if;
 if p_usuario is null then raise exception 'Usuario requerido' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('abaco_operaciones:'||p_usuario::text,0));
end $$;
create function abaco_privado.puerta_sentencia_financiera() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform abaco_privado.puerta_financiera();return null;end $$;
create trigger libro_puerta before insert or update or delete on public.tarjetas
 for each statement execute function abaco_privado.puerta_sentencia_financiera();
create trigger libro_puerta before insert or update or delete on public.transacciones
 for each statement execute function abaco_privado.puerta_sentencia_financiera();

-- Native database identity, not a JWT field or a client-settable GUC, authorizes projection writes.
create function abaco_privado.proteger_saldo_proyectado() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='tarjetas' then
  if new.saldo_actual is distinct from old.saldo_actual and current_user<>'abaco_financiero' then
   raise exception 'Saldo exclusivo del proyector financiero' using errcode='42501'; end if;
 else
  if current_user<>'abaco_financiero' then raise exception 'Proyeccion exclusiva del escritor financiero' using errcode='42501'; end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger libro_saldo_unico before update on public.tarjetas
 for each row execute function abaco_privado.proteger_saldo_proyectado();
create trigger libro_proyeccion_unica before insert or update or delete on public.libro_proyecciones
 for each row execute function abaco_privado.proteger_saldo_proyectado();

create function abaco_privado.escribir_proyeccion(p_tarjeta uuid,p_delta_legacy numeric default null,p_operacion uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare estado text;cuenta public.tarjetas;m abaco_privado.libro_cuentas;base numeric;nuevo numeric;revision bigint;
 cache public.libro_proyecciones;op public.libro_operaciones;importe numeric;ultima bigint;cantidad bigint;
begin
 estado:=abaco_privado.puerta_financiera();
 select * into strict cuenta from public.tarjetas where id=p_tarjeta for update;
 if estado='legacy' then
  if p_delta_legacy is null or p_delta_legacy::text in ('NaN','Infinity','-Infinity') then raise exception 'Delta legacy invalido';end if;
  nuevo:=coalesce(cuenta.saldo_actual,0)+p_delta_legacy;
 else
  select * into strict m from abaco_privado.libro_cuentas where tarjeta_id=p_tarjeta;
  select saldo_inicial into strict base from public.libro_aperturas where id=m.apertura_id and modo='operativo';
  if p_operacion is null then
   -- Opening or explicit recovery: full authoritative reconstruction, never the hot expense path.
   select case when base is null then null else coalesce(sum(p.importe),0) end into nuevo
    from public.libro_apuntes p where p.apertura_id=m.apertura_id;
   select count(*),max(secuencia) into cantidad,revision from public.libro_operaciones where apertura_id=m.apertura_id and operativa;
   if cantidad<1 or cantidad<>revision then raise exception 'Secuencia del libro inconsistente';end if;
  else
   select * into strict op from public.libro_operaciones where id=p_operacion and apertura_id=m.apertura_id
    and tarjeta_id=m.tarjeta_id and usuario_id=m.usuario_id and operativa and tipo='gasto';
   select secuencia into strict ultima from public.libro_operaciones where apertura_id=m.apertura_id and operativa order by secuencia desc limit 1;
   select * into cache from public.libro_proyecciones where tarjeta_id=m.tarjeta_id for update;
   if not found then raise exception 'Proyeccion ausente; reconstruir antes de escribir' using errcode='55000';end if;
   if op.secuencia<>ultima or cache.version<>op.secuencia-1 or cache.apertura_id<>m.apertura_id or cache.usuario_id<>m.usuario_id
    or cache.saldo is distinct from cuenta.saldo_actual or (base is null)<>(cache.saldo is null) then
    raise exception 'Proyeccion o secuencia inconsistente; reconstruir antes de escribir' using errcode='55000';end if;
   select p.importe into strict importe from public.libro_apuntes p where p.operacion_id=op.id;
   -- Derive the delta from the immutable canonical entry, NOT from the numeric argument.
   nuevo:=case when base is null then null else cache.saldo+importe end;
   revision:=op.secuencia;
  end if;
  insert into public.libro_proyecciones(usuario_id,tarjeta_id,apertura_id,saldo,version)
   values(m.usuario_id,m.tarjeta_id,m.apertura_id,nuevo,revision)
   on conflict(tarjeta_id) do update set saldo=excluded.saldo,version=excluded.version,actualizado_at=clock_timestamp();
 end if;
 -- The ONLY UPDATE of the compatibility balance anywhere in the installed database.
 update public.tarjetas set saldo_actual=nuevo where id=p_tarjeta and saldo_actual is distinct from nuevo;
end $$;
grant create on schema abaco_privado to abaco_financiero;
alter function abaco_privado.escribir_proyeccion(uuid,numeric,uuid) owner to abaco_financiero;
revoke create on schema abaco_privado from abaco_financiero;

create function abaco_privado.validar_operacion_libro() returns trigger
language plpgsql security definer set search_path='' as $$
declare modo_apertura text;begin
 select modo into strict modo_apertura from public.libro_aperturas where id=new.apertura_id;
 if new.operativa is distinct from (modo_apertura='operativo') then raise exception 'Modo de operacion incompatible';end if;
 if new.operativa and not exists(select 1 from abaco_privado.libro_cuentas
   where apertura_id=new.apertura_id and usuario_id=new.usuario_id and tarjeta_id=new.tarjeta_id) then
  raise exception 'Apertura operativa sin vinculo de cuenta';end if;
 if new.operativa and ((new.tipo='apertura' and new.secuencia<>1) or (new.tipo='gasto' and new.secuencia<=1)) then
  raise exception 'Secuencia incompatible con tipo de operacion';end if;
 if new.operativa and new.transaccion_id is not null and exists(select 1 from public.libro_historicos_incluidos
   where apertura_id=new.apertura_id and transaccion_id=new.transaccion_id) then
  raise exception 'Historico ya representado en apertura' using errcode='23505';end if;
 return new;
end $$;
create trigger libro_validar_operacion before insert on public.libro_operaciones
 for each row execute function abaco_privado.validar_operacion_libro();

create function abaco_privado.abrir_cuenta_operativa(p_tarjeta uuid,p_fuente text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.tarjetas;a uuid;op uuid;corte uuid;
begin
 select * into strict c from public.tarjetas where id=p_tarjeta;
 perform abaco_privado.bloquear_operaciones_usuario(c.usuario_id);
 select * into strict c from public.tarjetas where id=p_tarjeta for update;
 if exists(select 1 from abaco_privado.libro_cuentas where tarjeta_id=c.id) then raise exception 'Cuenta ya tiene apertura operativa';end if;
 select corte_id into strict corte from abaco_privado.libro_control where singleton and modo='libro';
 insert into public.libro_aperturas(usuario_id,tarjeta_id,moneda,tipo_producto,saldo_inicial,solicitud_id,modo,fuente)
  values(c.usuario_id,c.id,c.moneda,c.tipo_producto,c.saldo_actual,gen_random_uuid(),'operativo',p_fuente) returning id into a;
 insert into abaco_privado.libro_cuentas(usuario_id,tarjeta_id,apertura_id,corte_id) values(c.usuario_id,c.id,a,corte);
 insert into public.libro_historicos_incluidos(usuario_id,apertura_id,transaccion_id,tarjeta_id,monto_cuenta_snapshot)
  select c.usuario_id,a,id,c.id,monto_cuenta from public.transacciones where usuario_id=c.usuario_id and tarjeta_id=c.id and estado_revision='confirmado';
 insert into public.libro_operaciones(usuario_id,apertura_id,tarjeta_id,tipo,operativa,secuencia)
  values(c.usuario_id,a,c.id,'apertura',true,1) returning id into op;
 if c.saldo_actual is not null then
  insert into public.libro_apuntes(usuario_id,apertura_id,operacion_id,importe) values(c.usuario_id,a,op,c.saldo_actual);
 end if;
 perform abaco_privado.escribir_proyeccion(c.id);
 return a;
end $$;
create function abaco_privado.alta_cuenta_libro() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if abaco_privado.puerta_financiera()='libro' then perform abaco_privado.abrir_cuenta_operativa(new.id,'alta_cuenta_no_conciliada');end if;
 return new;
end $$;
create trigger libro_alta_cuenta after insert on public.tarjetas
 for each row execute function abaco_privado.alta_cuenta_libro();

create function abaco_privado.proteger_recepcion_contabilizada() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.estado_revision='confirmado' and row(new.id,new.usuario_id,new.tarjeta_id,new.evento_id,new.monto_original,new.moneda_original,new.monto_clp,new.monto_cuenta,new.estado_revision)
  is distinct from row(old.id,old.usuario_id,old.tarjeta_id,old.evento_id,old.monto_original,old.moneda_original,old.monto_clp,old.monto_cuenta,old.estado_revision) then
  raise exception 'Recepcion contabilizada inmutable' using errcode='42501';end if;
 return new;
end $$;
create trigger libro_recepcion_inmutable before update on public.transacciones
 for each row execute function abaco_privado.proteger_recepcion_contabilizada();

create function abaco_privado.contabilizar_recepcion() returns trigger
language plpgsql security definer set search_path='' as $$
declare estado text;c public.tarjetas;m abaco_privado.libro_cuentas;op uuid;importe numeric;siguiente bigint;
begin
 if new.estado_revision<>'confirmado' then return new;end if;
 if tg_op='UPDATE' then if old.estado_revision='confirmado' then return new;end if;end if;
 perform abaco_privado.bloquear_operaciones_usuario(new.usuario_id);
 estado:=abaco_privado.puerta_financiera();
 select * into strict c from public.tarjetas where id=new.tarjeta_id and usuario_id=new.usuario_id for update;
 if new.monto_cuenta is null or new.monto_cuenta<=0 or new.monto_cuenta::text in ('NaN','Infinity','-Infinity') then raise exception 'Gasto sin importe contabilizable';end if;
 importe:=case when c.tipo_producto='cuenta_corriente' then -new.monto_cuenta else new.monto_cuenta end;
 if estado='libro' then
  select * into strict m from abaco_privado.libro_cuentas where tarjeta_id=c.id;
  -- Account row/advisory lock held. Indexed last canonical sequence, independent of cache health.
  select secuencia+1 into strict siguiente from public.libro_operaciones where apertura_id=m.apertura_id and operativa order by secuencia desc limit 1;
  insert into public.libro_operaciones(usuario_id,apertura_id,tarjeta_id,tipo,transaccion_id,operativa,secuencia)
   values(c.usuario_id,m.apertura_id,c.id,'gasto',new.id,true,siguiente) returning id into op;
  insert into public.libro_apuntes(usuario_id,apertura_id,operacion_id,importe) values(c.usuario_id,m.apertura_id,op,importe);
 end if;
 perform abaco_privado.escribir_proyeccion(c.id,importe,op);
 return new;
end $$;
drop trigger trigger_actualizar_saldo_tarjeta on public.transacciones;
drop function public.actualizar_saldo_tarjeta();
create trigger libro_contabilizar after insert or update on public.transacciones
 for each row execute function abaco_privado.contabilizar_recepcion();
-- The existing private expense validator and ALL public v1/v2 wrappers remain unchanged.
-- Confirmation now changes the receipt only; the same receipt trigger publishes its single effect.
create or replace function abaco_privado.confirmar_gasto_pendiente(p_id uuid,p_monto_cuenta numeric)
returns void language plpgsql security definer set search_path='' as $$
declare gasto public.transacciones;
begin
 if auth.uid() is null then raise exception 'Sesion requerida' using errcode='42501';end if;
 select * into gasto from public.transacciones where id=p_id and usuario_id=auth.uid() for update;
 if not found then raise exception 'Gasto no autorizado' using errcode='42501';end if;
 if gasto.estado_revision<>'pendiente' then return;end if;
 if p_monto_cuenta is null or p_monto_cuenta<=0 or p_monto_cuenta>=1000000000000
  or p_monto_cuenta::text in ('NaN','Infinity','-Infinity') then raise exception 'Importe de cuenta invalido' using errcode='22023';end if;
 update public.transacciones set monto_cuenta=p_monto_cuenta,estado_revision='confirmado',motivo_revision=null where id=p_id;
end $$;

create view public.libro_saldos_calculados with(security_invoker=true) as
 select a.usuario_id,a.tarjeta_id,a.id as apertura_id,a.moneda,a.tipo_producto,a.saldo_inicial,
 case when a.saldo_inicial is null then null else coalesce((select sum(p.importe) from public.libro_apuntes p where p.apertura_id=a.id),0) end as saldo,
 (select count(*) from public.libro_operaciones o where o.apertura_id=a.id and o.operativa) as version
 from public.libro_aperturas a where a.modo='operativo';
revoke all on public.libro_saldos_calculados from public,anon,authenticated,service_role;
grant select on public.libro_saldos_calculados to authenticated;
-- Keep the old rehearsal view semantically separate from the new operative openings.
create or replace view public.libro_saldos_ensayo with(security_invoker=true) as
 select a.id as apertura_id,a.usuario_id,a.tarjeta_id,a.moneda,a.tipo_producto,a.modo,a.fuente,a.saldo_inicial,
 case when a.saldo_inicial is null then null else coalesce((select sum(p.importe) from public.libro_apuntes p where p.apertura_id=a.id),0) end as saldo_reconstruido
 from public.libro_aperturas a where a.modo='ensayo';

create function abaco_privado.verificar_estructura_operativa() returns boolean
language sql security definer set search_path='' as $$
 select
 (select count(*) from abaco_privado.libro_cuentas)=(select count(*) from public.tarjetas)
 and not exists(select 1 from public.libro_aperturas a where a.modo='operativo' and not exists(select 1 from abaco_privado.libro_cuentas m where m.apertura_id=a.id))
 and not exists(select 1 from abaco_privado.libro_cuentas m join public.libro_aperturas a on a.id=m.apertura_id where
  a.modo<>'operativo' or (select count(*) from public.libro_operaciones o where o.apertura_id=a.id and o.tipo='apertura' and o.operativa and o.secuencia=1)<>1
  or (select count(*) from public.libro_operaciones o where o.apertura_id=a.id and o.operativa) is distinct from
     (select max(o.secuencia) from public.libro_operaciones o where o.apertura_id=a.id and o.operativa)
  or exists(select 1 from public.libro_operaciones o left join public.libro_apuntes p on p.operacion_id=o.id where o.apertura_id=a.id and
   (not o.operativa or (o.tipo='apertura' and ((a.saldo_inicial is null and p.id is not null) or
    (a.saldo_inicial is not null and (p.id is null or p.importe is distinct from a.saldo_inicial)))))))
 and not exists(select 1 from public.libro_operaciones o join abaco_privado.libro_cuentas m on m.apertura_id=o.apertura_id
  join public.libro_aperturas a on a.id=m.apertura_id left join public.transacciones t on t.id=o.transaccion_id left join public.libro_apuntes p on p.operacion_id=o.id
  where o.tipo='gasto' and (p.id is null or t.id is null or t.usuario_id<>m.usuario_id or t.tarjeta_id<>m.tarjeta_id or t.estado_revision<>'confirmado' or t.monto_cuenta is null
   or p.importe is distinct from case when a.tipo_producto='cuenta_corriente' then -t.monto_cuenta else t.monto_cuenta end
   or exists(select 1 from public.libro_historicos_incluidos h where h.apertura_id=m.apertura_id and h.transaccion_id=t.id)))
 and not exists(select 1 from public.transacciones t join abaco_privado.libro_cuentas m on m.tarjeta_id=t.tarjeta_id where t.estado_revision='confirmado'
  and not exists(select 1 from public.libro_historicos_incluidos h where h.apertura_id=m.apertura_id and h.transaccion_id=t.id)
  and not exists(select 1 from public.libro_operaciones o where o.apertura_id=m.apertura_id and o.transaccion_id=t.id and o.operativa))
 and not exists(select 1 from public.libro_historicos_incluidos h join abaco_privado.libro_cuentas m on m.apertura_id=h.apertura_id
  left join public.transacciones t on t.id=h.transaccion_id where t.id is null or t.estado_revision<>'confirmado' or t.usuario_id<>m.usuario_id or t.tarjeta_id<>m.tarjeta_id
   or t.monto_cuenta is distinct from h.monto_cuenta_snapshot)
$$;
create function abaco_privado.verificar_proyecciones() returns boolean
language sql security definer set search_path='' as $$
 select abaco_privado.verificar_estructura_operativa()
 and (select count(*) from public.libro_proyecciones)=(select count(*) from abaco_privado.libro_cuentas)
 and not exists(select 1 from public.libro_saldos_calculados v join public.tarjetas t on t.id=v.tarjeta_id
  left join public.libro_proyecciones p on p.tarjeta_id=v.tarjeta_id where p.tarjeta_id is null or p.apertura_id<>v.apertura_id
   or p.saldo is distinct from v.saldo or p.version<>v.version or t.saldo_actual is distinct from v.saldo)
$$;

create function abaco_privado.activar_libro(p_solicitud uuid,p_confirmacion text) returns uuid
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare estado abaco_privado.libro_control;c record;
begin
 if p_solicitud is null or p_confirmacion is distinct from 'activar-libro-con-saldos-comprometidos' then raise exception 'Confirmacion de corte requerida';end if;
 select * into strict estado from abaco_privado.libro_control where singleton for update;
 if estado.corte_id is not null then
  if estado.corte_id=p_solicitud then return estado.corte_id;end if;
  raise exception 'Ya existe un corte; no se reabren cuentas';end if;
 update abaco_privado.libro_control set modo='libro',corte_id=p_solicitud,activado_at=clock_timestamp() where singleton;
 for c in select id from public.tarjetas order by usuario_id,id loop
  perform abaco_privado.abrir_cuenta_operativa(c.id,'saldo_legacy_no_conciliado');
 end loop;
 if not abaco_privado.verificar_proyecciones() then raise exception 'Corte inconsistente';end if;
 insert into abaco_privado.libro_eventos_control(corte_id,evento) values(p_solicitud,'activar');
 return p_solicitud;
end $$;
create function abaco_privado.pausar_libro(p_confirmacion text) returns void
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare estado abaco_privado.libro_control;
begin
 if p_confirmacion is distinct from 'pausar-escritores' then raise exception 'Confirmacion requerida';end if;
 select * into strict estado from abaco_privado.libro_control where singleton for update;
 if estado.modo='legacy' then raise exception 'Libro no activado';end if;
 if estado.modo='pausado' then return;end if;
 update abaco_privado.libro_control set modo='pausado' where singleton;
 insert into abaco_privado.libro_eventos_control(corte_id,evento) values(estado.corte_id,'pausar');
end $$;
create function abaco_privado.reconstruir_proyecciones(p_confirmacion text) returns void
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare estado abaco_privado.libro_control;c record;
begin
 if p_confirmacion is distinct from 'reconstruir-desde-apuntes' then raise exception 'Confirmacion requerida';end if;
 select * into strict estado from abaco_privado.libro_control where singleton for update;
 if estado.modo='legacy' then raise exception 'Libro no activado';end if;
 if not abaco_privado.verificar_estructura_operativa() then raise exception 'Libro inconsistente; no reconstruir ni inventar importes';end if;
 -- Hidden inside this transaction under the exclusive gate; waiting callers see only the final mode.
 update abaco_privado.libro_control set modo='libro' where singleton;
 for c in select tarjeta_id from abaco_privado.libro_cuentas order by usuario_id,tarjeta_id loop
  perform abaco_privado.escribir_proyeccion(c.tarjeta_id);
 end loop;
 if not abaco_privado.verificar_proyecciones() then raise exception 'Reconstruccion inconsistente';end if;
 update abaco_privado.libro_control set modo=estado.modo where singleton;
 insert into abaco_privado.libro_eventos_control(corte_id,evento) values(estado.corte_id,'reconstruir');
end $$;
create function abaco_privado.reanudar_libro(p_confirmacion text) returns void
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare estado abaco_privado.libro_control;
begin
 if p_confirmacion is distinct from 'reanudar-libro-validado' then raise exception 'Confirmacion requerida';end if;
 select * into strict estado from abaco_privado.libro_control where singleton for update;
 if estado.modo<>'pausado' then raise exception 'Primero pausar el libro';end if;
 if not abaco_privado.verificar_proyecciones() then raise exception 'Proyeccion inconsistente; reconstruir antes de reanudar';end if;
 update abaco_privado.libro_control set modo='libro' where singleton;
 insert into abaco_privado.libro_eventos_control(corte_id,evento) values(estado.corte_id,'reanudar');
end $$;

revoke all on all functions in schema abaco_privado from public,anon,authenticated,service_role;
grant execute on function abaco_privado.puerta_financiera() to abaco_financiero;
grant execute on function abaco_privado.escribir_proyeccion(uuid,numeric,uuid) to postgres;
notify pgrst, 'reload schema';
commit;
