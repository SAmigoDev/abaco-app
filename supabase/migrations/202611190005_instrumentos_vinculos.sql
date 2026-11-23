begin;
-- Stage 005 is additive. The balance trigger and private expense engine are unchanged.
alter table public.tarjetas add constraint tarjetas_owner_producto_unique unique(usuario_id,id,moneda,tipo_producto);
create table public.instrumentos_pago (
 id uuid primary key default gen_random_uuid(), usuario_id uuid not null references public.usuarios(id) on delete cascade,
 alias text not null check(length(btrim(alias)) between 1 and 80),
 tipo text not null check(tipo in ('wallet','fisica','otro')), created_at timestamptz not null default now(), archivado_at timestamptz,
 unique(usuario_id,id)
);
create table public.vinculos_captura (
 id uuid primary key default gen_random_uuid(), usuario_id uuid not null references public.usuarios(id) on delete cascade,
 instrumento_id uuid not null, tarjeta_id uuid not null, moneda_cuenta text not null, tipo_producto_cuenta text not null,
 created_at timestamptz not null default now(), revocado_at timestamptz,
 unique(usuario_id,id,tarjeta_id),
 foreign key(usuario_id,instrumento_id) references public.instrumentos_pago(usuario_id,id) on delete no action deferrable initially deferred,
 foreign key(usuario_id,tarjeta_id,moneda_cuenta,tipo_producto_cuenta) references public.tarjetas(usuario_id,id,moneda,tipo_producto) on delete no action deferrable initially deferred
);
create unique index vinculos_activos_unicos on public.vinculos_captura(usuario_id,instrumento_id,tarjeta_id) where revocado_at is null;
alter table public.integraciones_atajos add column vinculo_id uuid,
 add constraint integracion_vinculo_owner foreign key(usuario_id,vinculo_id,tarjeta_id) references public.vinculos_captura(usuario_id,id,tarjeta_id) on delete no action deferrable initially deferred;
grant select(vinculo_id) on public.integraciones_atajos to authenticated;
alter table public.transacciones add column vinculo_captura_id uuid,
 add column version_captura smallint not null default 1 check(version_captura in (1,2)),
 add constraint transaccion_version_vinculo check(version_captura=1 or vinculo_captura_id is not null),
 add constraint transaccion_vinculo_owner foreign key(usuario_id,vinculo_captura_id,tarjeta_id) references public.vinculos_captura(usuario_id,id,tarjeta_id) on delete no action deferrable initially deferred;

alter table public.instrumentos_pago enable row level security;
alter table public.vinculos_captura enable row level security;
create policy instrumentos_propios on public.instrumentos_pago for select to authenticated using(usuario_id=auth.uid());
create policy instrumentos_mfa on public.instrumentos_pago as restrictive for all to authenticated using((select public.acceso_protegido())) with check((select public.acceso_protegido()));
create policy vinculos_propios on public.vinculos_captura for select to authenticated using(usuario_id=auth.uid());
create policy vinculos_mfa on public.vinculos_captura as restrictive for all to authenticated using((select public.acceso_protegido())) with check((select public.acceso_protegido()));
revoke all on public.instrumentos_pago,public.vinculos_captura from public,anon,authenticated,service_role;
grant select on public.instrumentos_pago,public.vinculos_captura to authenticated;
-- Machine requests use the checked definer RPC, not direct table DML.
revoke insert,update,delete on public.integraciones_atajos,public.transacciones from service_role;

create function abaco_privado.bloquear_operaciones_usuario(p_usuario uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_usuario is null then raise exception 'Usuario requerido' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('abaco_operaciones:'||p_usuario::text,0));
end $$;
revoke all on function abaco_privado.bloquear_operaciones_usuario(uuid) from public,anon,authenticated,service_role;

create function abaco_privado.proteger_destinos_atajos()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='integraciones_atajos' then
  if row(new.id,new.usuario_id,new.tarjeta_id,new.vinculo_id,new.token_hash,new.created_at)
     is distinct from row(old.id,old.usuario_id,old.tarjeta_id,old.vinculo_id,old.token_hash,old.created_at) then
   raise exception 'Destino y credencial inmutables; crea un perfil nuevo' using errcode='42501';
  end if;
 elsif tg_table_name='vinculos_captura' then
  if row(new.id,new.usuario_id,new.instrumento_id,new.tarjeta_id,new.moneda_cuenta,new.tipo_producto_cuenta,new.created_at)
     is distinct from row(old.id,old.usuario_id,old.instrumento_id,old.tarjeta_id,old.moneda_cuenta,old.tipo_producto_cuenta,old.created_at) then
   raise exception 'Vinculo inmutable; crea otro vinculo' using errcode='42501';
  end if;
 else
  if row(new.id,new.usuario_id,new.tipo,new.created_at) is distinct from row(old.id,old.usuario_id,old.tipo,old.created_at) then
   raise exception 'Identidad de instrumento inmutable' using errcode='42501';
  end if;
  if old.archivado_at is not null then
   if new.archivado_at is null then raise exception 'No se reactiva un instrumento archivado' using errcode='42501'; end if;
   new.archivado_at:=old.archivado_at;
  end if;
  return new;
 end if;
 if old.revocado_at is not null then
  if new.revocado_at is null then raise exception 'No se reactiva un perfil revocado' using errcode='42501'; end if;
  new.revocado_at:=old.revocado_at;
 end if;
 return new;
end $$;
revoke all on function abaco_privado.proteger_destinos_atajos() from public,anon,authenticated,service_role;
create trigger proteger_integracion_atajo before update on public.integraciones_atajos for each row execute function abaco_privado.proteger_destinos_atajos();
create trigger proteger_vinculo_captura before update on public.vinculos_captura for each row execute function abaco_privado.proteger_destinos_atajos();
create trigger proteger_instrumento_pago before update on public.instrumentos_pago for each row execute function abaco_privado.proteger_destinos_atajos();

create function public.crear_instrumento_pago(p_alias text,p_tipo text default 'wallet')
returns uuid language plpgsql security definer set search_path='' as $$
declare resultado uuid;
begin
 perform abaco_privado.exigir_acceso(); perform abaco_privado.bloquear_operaciones_usuario(auth.uid());
 if p_alias is null or length(btrim(p_alias)) not between 1 and 80 or p_tipo is null or p_tipo not in ('wallet','fisica','otro') then
  raise exception 'Instrumento invalido' using errcode='22023'; end if;
 insert into public.instrumentos_pago(usuario_id,alias,tipo) values(auth.uid(),btrim(p_alias),p_tipo) returning id into resultado;
 return resultado;
end $$;
create function public.crear_vinculo_captura(p_instrumento uuid,p_tarjeta uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare cuenta public.tarjetas; resultado uuid;
begin
 perform abaco_privado.exigir_acceso(); perform abaco_privado.bloquear_operaciones_usuario(auth.uid());
 if not exists(select 1 from public.instrumentos_pago where id=p_instrumento and usuario_id=auth.uid() and archivado_at is null) then
  raise exception 'Instrumento no autorizado' using errcode='42501'; end if;
 select * into cuenta from public.tarjetas where id=p_tarjeta and usuario_id=auth.uid() for update;
 if not found then raise exception 'Cuenta no autorizada' using errcode='42501'; end if;
 insert into public.vinculos_captura(usuario_id,instrumento_id,tarjeta_id,moneda_cuenta,tipo_producto_cuenta)
 values(auth.uid(),p_instrumento,p_tarjeta,cuenta.moneda,cuenta.tipo_producto) returning id into resultado;
 return resultado;
end $$;
create function public.crear_credencial_vinculo(p_vinculo uuid,p_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare vinculo public.vinculos_captura; resultado uuid;
begin
 perform abaco_privado.exigir_acceso(); perform abaco_privado.bloquear_operaciones_usuario(auth.uid());
 select v.* into vinculo from public.vinculos_captura v join public.instrumentos_pago i on i.id=v.instrumento_id and i.usuario_id=v.usuario_id
 where v.id=p_vinculo and v.usuario_id=auth.uid() and v.revocado_at is null and i.archivado_at is null for update of v;
 if not found then raise exception 'Vinculo no autorizado' using errcode='42501'; end if;
 if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Hash invalido' using errcode='22023'; end if;
 if (select count(*) from public.integraciones_atajos where usuario_id=auth.uid() and revocado_at is null)>=10 then
  raise exception 'Revoca una credencial antes de crear otra' using errcode='54000'; end if;
 insert into public.integraciones_atajos(usuario_id,tarjeta_id,vinculo_id,token_hash)
 values(auth.uid(),vinculo.tarjeta_id,vinculo.id,p_hash) returning id into resultado;
 return resultado;
end $$;
create function public.revocar_vinculo_captura(p_vinculo uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform abaco_privado.exigir_acceso(); perform abaco_privado.bloquear_operaciones_usuario(auth.uid());
 if not exists(select 1 from public.vinculos_captura where id=p_vinculo and usuario_id=auth.uid()) then
  raise exception 'Vinculo no autorizado' using errcode='42501'; end if;
 update public.vinculos_captura set revocado_at=coalesce(revocado_at,now()) where id=p_vinculo and usuario_id=auth.uid();
 update public.integraciones_atajos set revocado_at=coalesce(revocado_at,now()) where vinculo_id=p_vinculo and usuario_id=auth.uid();
end $$;
create function public.archivar_instrumento_pago(p_instrumento uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform abaco_privado.exigir_acceso(); perform abaco_privado.bloquear_operaciones_usuario(auth.uid());
 if not exists(select 1 from public.instrumentos_pago where id=p_instrumento and usuario_id=auth.uid()) then
  raise exception 'Instrumento no autorizado' using errcode='42501'; end if;
 update public.instrumentos_pago set archivado_at=coalesce(archivado_at,now()) where id=p_instrumento and usuario_id=auth.uid();
 update public.vinculos_captura set revocado_at=coalesce(revocado_at,now()) where instrumento_id=p_instrumento and usuario_id=auth.uid();
 update public.integraciones_atajos set revocado_at=coalesce(revocado_at,now()) where usuario_id=auth.uid()
 and vinculo_id in (select id from public.vinculos_captura where instrumento_id=p_instrumento and usuario_id=auth.uid());
end $$;

-- Preserve the legacy signatures and private engine; serialize their public entry points.
create or replace function public.crear_integracion_atajo(p_tarjeta uuid,p_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform abaco_privado.exigir_acceso(); perform abaco_privado.bloquear_operaciones_usuario(auth.uid());
 return abaco_privado.crear_integracion_atajo(p_tarjeta,p_hash);
end $$;
create or replace function public.revocar_integracion_atajo(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform abaco_privado.exigir_acceso(); perform abaco_privado.bloquear_operaciones_usuario(auth.uid());
 perform abaco_privado.revocar_integracion_atajo(p_id);
end $$;
create or replace function public.confirmar_gasto_pendiente(p_id uuid,p_monto_cuenta numeric)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform abaco_privado.exigir_acceso(); perform abaco_privado.bloquear_operaciones_usuario(auth.uid());
 perform abaco_privado.confirmar_gasto_pendiente(p_id,p_monto_cuenta);
end $$;
create or replace function public.registrar_gasto(p_usuario uuid,p_datos jsonb,p_token_hash text default null)
returns public.transacciones language plpgsql security definer set search_path='' as $$
declare
 cred public.integraciones_atajos; anterior public.transacciones; resultado public.transacciones; propietario uuid;
 version_solicitada integer:=1; evento uuid;
begin
 if auth.role()='service_role' and p_token_hash is not null and p_usuario is null then
  select usuario_id into propietario from public.integraciones_atajos where token_hash=p_token_hash and revocado_at is null;
  if not found then raise exception 'Credencial invalida' using errcode='28000'; end if;
  perform abaco_privado.bloquear_operaciones_usuario(propietario);
  select * into cred from public.integraciones_atajos where token_hash=p_token_hash and revocado_at is null for update;
  if not found then raise exception 'Credencial invalida' using errcode='28000'; end if;
  if cred.vinculo_id is not null and not exists(select 1 from public.vinculos_captura v join public.instrumentos_pago i on i.id=v.instrumento_id and i.usuario_id=v.usuario_id
    where v.id=cred.vinculo_id and v.usuario_id=cred.usuario_id and v.tarjeta_id=cred.tarjeta_id and v.revocado_at is null and i.archivado_at is null) then
   raise exception 'Credencial invalida' using errcode='28000'; end if;
  if p_datos ? 'version' then
   if jsonb_typeof(p_datos->'version')<>'number' or p_datos->>'version' not in ('1','2') then
    raise exception 'Version invalida' using errcode='22023'; end if;
   version_solicitada:=(p_datos->>'version')::integer;
  end if;
  if version_solicitada=2 then
   if cred.vinculo_id is null or (p_datos->>'binding_id')::uuid is distinct from cred.vinculo_id then
    raise exception 'Vinculo no autorizado' using errcode='42501'; end if;
   if jsonb_typeof(p_datos->'monto') is distinct from 'number' or p_datos ? 'tarjeta_id' or p_datos ? 'tarjetaId' then
    raise exception 'Contrato v2 invalido' using errcode='22023'; end if;
  elsif p_datos ? 'binding_id' then raise exception 'binding_id requiere version 2' using errcode='22023'; end if;
  evento:=(p_datos->>'evento_id')::uuid;
  select * into anterior from public.transacciones where usuario_id=propietario and evento_id=evento;
  if found and (anterior.vinculo_captura_id is distinct from cred.vinculo_id or anterior.version_captura<>version_solicitada) then
   raise exception 'evento_id ya usado con otro vinculo o version' using errcode='23505'; end if;
  resultado:=abaco_privado.registrar_gasto(null,p_datos-'binding_id'-'version',p_token_hash);
  if cred.vinculo_id is not null and anterior.id is null then
   update public.transacciones set vinculo_captura_id=cred.vinculo_id,version_captura=version_solicitada where id=resultado.id returning * into resultado;
  end if;
  return resultado;
 end if;
 perform abaco_privado.exigir_acceso();
 if auth.role()<>'authenticated' or p_usuario is distinct from auth.uid() or p_token_hash is not null then
  raise exception 'Registro no autorizado' using errcode='42501'; end if;
 perform abaco_privado.bloquear_operaciones_usuario(auth.uid());
 return abaco_privado.registrar_gasto(auth.uid(),p_datos,null);
end $$;

revoke all on function public.crear_instrumento_pago(text,text),public.crear_vinculo_captura(uuid,uuid),public.crear_credencial_vinculo(uuid,text),public.revocar_vinculo_captura(uuid),public.archivar_instrumento_pago(uuid) from public,anon,authenticated,service_role;
grant execute on function public.crear_instrumento_pago(text,text),public.crear_vinculo_captura(uuid,uuid),public.crear_credencial_vinculo(uuid,text),public.revocar_vinculo_captura(uuid),public.archivar_instrumento_pago(uuid) to authenticated;
-- CREATE OR REPLACE keeps the restricted ACL of the legacy wrappers from004.
notify pgrst, 'reload schema';
commit;
