begin;
alter table public.transacciones
  add column evento_id uuid,
  add column estado_revision text not null default 'confirmado',
  add column motivo_revision text,
  add column fecha_captura timestamptz not null default now(),
  add column monto_cuenta numeric;
alter table public.transacciones add constraint transacciones_evento_unique unique(usuario_id, evento_id);
alter table public.transacciones add constraint transacciones_revision_check
  check (estado_revision in ('confirmado','pendiente'));
alter table public.transacciones drop constraint transacciones_origen_check;
alter table public.transacciones add constraint transacciones_origen_check
  check (origen in ('regex_sms','regex_email','manual','ocr','fijo','apple_wallet','atajo_manual'));
-- NOT VALID preserves historical rows but enforces new writes.
alter table public.transacciones add constraint transacciones_monto_positivo
  check (monto_original > 0 and monto_original < 1000000000000
    and monto_clp >= 0 and monto_clp < 1000000000000000) not valid;

create table public.integraciones_atajos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  tarjeta_id uuid not null references public.tarjetas(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revocado_at timestamptz,
  ventana_inicio timestamptz not null default now(),
  usos integer not null default 0
);
alter table public.integraciones_atajos enable row level security;
create policy integraciones_propias on public.integraciones_atajos for select to authenticated
  using (usuario_id = auth.uid());
revoke all on public.integraciones_atajos from public, anon, authenticated;
grant select(id, usuario_id, tarjeta_id, created_at, revocado_at) on public.integraciones_atajos to authenticated;
grant all on public.integraciones_atajos to service_role;

create function public.crear_integracion_atajo(p_tarjeta uuid, p_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare resultado uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.tarjetas where id=p_tarjeta and usuario_id=auth.uid()) then
    raise exception 'Medio de pago no autorizado' using errcode='42501';
  end if;
  perform 1 from public.usuarios where id=auth.uid() for update;
  if (select count(*) from public.integraciones_atajos where usuario_id=auth.uid() and revocado_at is null) >= 10 then
    raise exception 'Revoca una credencial antes de crear otra';
  end if;
  insert into public.integraciones_atajos(usuario_id,tarjeta_id,token_hash)
    values(auth.uid(),p_tarjeta,p_hash) returning id into resultado;
  return resultado;
end $$;
create function public.revocar_integracion_atajo(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.integraciones_atajos set revocado_at=now()
    where id=p_id and usuario_id=auth.uid();
$$;
revoke all on function public.crear_integracion_atajo(uuid,text), public.revocar_integracion_atajo(uuid) from public, anon;
grant execute on function public.crear_integracion_atajo(uuid,text), public.revocar_integracion_atajo(uuid) to authenticated;

-- All new writes use one atomic engine. Existing balances are never rebuilt.
create or replace function public.actualizar_saldo_tarjeta()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.estado_revision = 'confirmado' then
    update public.tarjetas set saldo_actual = coalesce(saldo_actual,0) +
      case when tipo_producto='cuenta_corriente' then -new.monto_cuenta else new.monto_cuenta end
    where id=new.tarjeta_id and usuario_id=new.usuario_id;
  end if;
  return new;
end $$;

create function public.registrar_gasto(p_usuario uuid, p_datos jsonb, p_token_hash text default null)
returns public.transacciones language plpgsql security definer set search_path = '' as $$
declare
  medio public.tarjetas;
  integracion public.integraciones_atajos;
  resultado public.transacciones;
  evento uuid := (p_datos->>'evento_id')::uuid;
  tarjeta uuid := (p_datos->>'tarjetaId')::uuid;
  categoria uuid := nullif(p_datos->>'categoriaId','')::uuid;
  monto numeric := (p_datos->>'monto')::numeric;
  moneda text := p_datos->>'moneda';
  comercio text := btrim(p_datos->>'comercio');
  origen text := coalesce(p_datos->>'origen','manual');
  fecha timestamptz := (p_datos->>'fecha')::timestamptz;
  tasa numeric;
  clp numeric;
  motivo text;
  cuotas integer := nullif(p_datos->>'numCuotas','')::integer;
  interes numeric := nullif(p_datos->>'tasaCuotas','')::numeric;
begin
  if p_token_hash is not null then
    select * into integracion from public.integraciones_atajos
      where token_hash=p_token_hash and revocado_at is null for update;
    if not found then raise exception 'Credencial inválida' using errcode='28000'; end if;
    p_usuario := integracion.usuario_id;
    tarjeta := integracion.tarjeta_id;
    if origen not in ('apple_wallet','atajo_manual') then raise exception 'Origen inválido'; end if;
  elsif p_usuario is null or origen not in ('manual','regex_sms','regex_email','ocr','fijo') then
    raise exception 'Registro no autorizado' using errcode='42501';
  end if;
  if evento is null or monto is null or monto <= 0 or monto >= 1000000000000
    or monto::text in ('NaN','Infinity','-Infinity') or moneda is null or moneda not in ('CLP','USD')
    or comercio is null or length(comercio) not between 1 and 200 or fecha is null
    or coalesce(p_datos->>'fecha','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    or not isfinite(fecha) or fecha > now()+interval '1 day'
    or coalesce(p_datos->>'tipo','gasto') <> 'gasto' then
    raise exception 'Datos de gasto inválidos' using errcode='22023';
  end if;
  if cuotas is not null and (p_token_hash is not null or cuotas not between 2 and 120
    or (interes is not null and (interes < 0 or interes >= 100 or interes::text='NaN'))) then
    raise exception 'Datos de cuotas inválidos' using errcode='22023';
  end if;
  -- Serialize retries across both endpoints before touching balances.
  perform pg_advisory_xact_lock(hashtextextended(p_usuario::text || evento::text,0));
  select * into resultado from public.transacciones where usuario_id=p_usuario and evento_id=evento;
  if found then
    if resultado.tarjeta_id is distinct from tarjeta or resultado.monto_original is distinct from monto
      or resultado.moneda_original is distinct from moneda or resultado.comercio is distinct from comercio
      or resultado.fecha is distinct from fecha or resultado.categoria_id is distinct from categoria
      or resultado.origen is distinct from origen then
      raise exception 'evento_id ya usado con otros datos' using errcode='23505';
    end if;
    if (cuotas is null and exists(select 1 from public.compras_cuotas where transaccion_id=resultado.id))
      or (cuotas is not null and not exists(select 1 from public.compras_cuotas
        where transaccion_id=resultado.id and num_cuotas=cuotas and tasa_interes_mensual is not distinct from interes)) then
      raise exception 'evento_id ya usado con otras cuotas' using errcode='23505';
    end if;
    return resultado;
  end if;
  if p_token_hash is not null then
    if integracion.ventana_inicio < now()-interval '1 minute' then
      update public.integraciones_atajos set ventana_inicio=now(),usos=1 where id=integracion.id;
    elsif integracion.usos >= 30 then
      raise exception 'Límite de solicitudes' using errcode='54000';
    else
      update public.integraciones_atajos set usos=usos+1 where id=integracion.id;
    end if;
  end if;
  select * into medio from public.tarjetas where id=tarjeta and usuario_id=p_usuario for update;
  if not found then raise exception 'Medio de pago no autorizado' using errcode='42501'; end if;
  if categoria is not null and not exists(select 1 from public.categorias where id=categoria and usuario_id=p_usuario) then
    raise exception 'Categoría no autorizada' using errcode='42501';
  end if;
  clp := monto;
  if moneda='USD' then
    select valor into tasa from public.tasas_cambio where tasas_cambio.moneda='USD';
    if tasa is null or tasa <= 0 or tasa >= 1000000 then
      raise exception 'Actualiza la tasa USD antes de registrar' using errcode='22023';
    end if;
    clp := round(monto*tasa,2);
  end if;
  if medio.moneda <> moneda then motivo := 'moneda_cuenta_distinta';
  elsif medio.saldo_actual is null then motivo := 'saldo_desconocido';
  elsif medio.tipo_producto='cuenta_corriente' and medio.saldo_actual < monto then motivo := 'saldo_insuficiente';
  elsif medio.tipo_producto <> 'cuenta_corriente' and medio.cupo_maximo is not null
      and medio.saldo_actual+monto > medio.cupo_maximo then motivo := 'cupo_insuficiente';
  end if;
  insert into public.transacciones(usuario_id,tarjeta_id,categoria_id,monto_original,moneda_original,
    monto_clp,comercio,fecha,origen,sincronizado,intentos_sync,evento_id,estado_revision,motivo_revision,monto_cuenta)
  values(p_usuario,tarjeta,categoria,monto,moneda,clp,comercio,fecha,origen,true,0,evento,
    case when motivo is null then 'confirmado' else 'pendiente' end,motivo,
    case when motivo is null then monto else null end) returning * into resultado;
  if cuotas is not null then
    if motivo is not null then
      raise exception 'Revisa la cuenta y moneda antes de registrar una compra en cuotas' using errcode='22023';
    end if;
    insert into public.compras_cuotas(usuario_id,transaccion_id,tarjeta_id,comercio,monto_total,
      num_cuotas,monto_cuota,fecha_primera_cuota,tasa_interes_mensual)
    values(p_usuario,resultado.id,tarjeta,comercio,monto,cuotas,monto/cuotas,
      (fecha at time zone 'America/Santiago')::date,interes);
  end if;
  return resultado;
end $$;
revoke all on function public.registrar_gasto(uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.registrar_gasto(uuid,jsonb,text) to service_role;

-- Prevent bypassing the engine, including UPDATE/DELETE with unaccounted balances.
revoke insert,update,delete on public.transacciones from public,anon,authenticated;
do $$
declare columnas text;
begin
  select string_agg(quote_ident(attname), ', ') into columnas from pg_attribute
    where attrelid='public.transacciones'::regclass and attnum>0 and not attisdropped;
  execute format('revoke insert (%s), update (%s) on public.transacciones from public,anon,authenticated',columnas,columnas);
end $$;
do $$
begin
  if has_any_column_privilege('authenticated','public.transacciones','INSERT')
    or has_any_column_privilege('authenticated','public.transacciones','UPDATE')
    or has_table_privilege('authenticated','public.transacciones','DELETE') then
    raise exception 'Permisos heredados permiten eludir el motor de gastos';
  end if;
end $$;
commit;
