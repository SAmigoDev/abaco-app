begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- Coordinated DDL window; no activation of 009 or changes to its balance writer.
lock table public.tarjetas,public.transacciones in access exclusive mode nowait;
alter table public.tarjetas add column archivado_at timestamptz;
revoke delete on public.tarjetas from public,anon,authenticated,service_role;
revoke update(archivado_at) on public.tarjetas from public,anon,authenticated,service_role;

create function abaco_privado.proteger_archivo_cuenta() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.archivado_at is not null then raise exception 'Una cuenta nueva debe estar activa' using errcode='42501';end if;
 elsif tg_op='UPDATE' then
  if old.archivado_at is not null and new.archivado_at is distinct from old.archivado_at then
   raise exception 'No se reactiva ni cambia la fecha de una cuenta archivada' using errcode='42501';end if;
 else
  if old.archivado_at is not null or exists(select 1 from public.transacciones where tarjeta_id=old.id)
   or exists(select 1 from public.libro_aperturas where tarjeta_id=old.id)
   or exists(select 1 from public.vinculos_captura where tarjeta_id=old.id)
   or exists(select 1 from public.integraciones_atajos where tarjeta_id=old.id)
   or exists(select 1 from public.compras_cuotas where tarjeta_id=old.id)
   or exists(select 1 from public.movimientos_fijos where tarjeta_id=old.id) then
   raise exception 'Cuenta con historial: archiva para conservar sus movimientos' using errcode='42501';end if;
  return old;
 end if;
 return new;
end $$;
create trigger cuenta_archivo_inmutable before insert or update or delete on public.tarjetas
 for each row execute function abaco_privado.proteger_archivo_cuenta();

create function abaco_privado.exigir_cuenta_activa() returns trigger
language plpgsql security definer set search_path='' as $$
declare cuenta public.tarjetas;
begin
 -- Optional account for fixed schedules; no capture is made by an unassigned schedule.
 if new.tarjeta_id is null then return new;end if;
 -- Same order as v1/v2 and archive: control barrier -> user -> account -> bindings/credentials.
 perform abaco_privado.bloquear_operaciones_usuario(new.usuario_id);
 select * into cuenta from public.tarjetas where id=new.tarjeta_id and usuario_id=new.usuario_id for update;
 if not found then raise exception 'Cuenta no autorizada' using errcode='42501';end if;
 if cuenta.archivado_at is not null then raise exception 'Cuenta archivada: no admite nuevas capturas, vinculos ni credenciales' using errcode='42501';end if;
 return new;
end $$;
-- Protect every actual insert, including SECURITY DEFINER and service/operator routes.
-- Already committed receipt replays are handled before INSERT by the unchanged v1/v2 validator.
create trigger cuenta_activa_captura before insert or update of tarjeta_id,usuario_id on public.transacciones
 for each row execute function abaco_privado.exigir_cuenta_activa();
create trigger cuenta_activa_vinculo before insert on public.vinculos_captura
 for each row execute function abaco_privado.exigir_cuenta_activa();
create trigger cuenta_activa_credencial before insert on public.integraciones_atajos
 for each row execute function abaco_privado.exigir_cuenta_activa();
create trigger cuenta_activa_cuotas before insert or update of tarjeta_id,usuario_id on public.compras_cuotas
 for each row execute function abaco_privado.exigir_cuenta_activa();
create trigger cuenta_activa_fijo before insert or update of tarjeta_id,usuario_id on public.movimientos_fijos
 for each row execute function abaco_privado.exigir_cuenta_activa();

create function public.archivar_cuenta(p_tarjeta uuid) returns public.tarjetas
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare cuenta public.tarjetas;
begin
 perform abaco_privado.exigir_acceso();
 perform abaco_privado.bloquear_operaciones_usuario(auth.uid());
 select * into cuenta from public.tarjetas where id=p_tarjeta and usuario_id=auth.uid() for update;
 if not found then raise exception 'Cuenta no autorizada' using errcode='42501';end if;
 update public.tarjetas set archivado_at=coalesce(archivado_at,clock_timestamp()) where id=cuenta.id returning * into cuenta;
 update public.integraciones_atajos set revocado_at=coalesce(revocado_at,clock_timestamp())
  where tarjeta_id=cuenta.id and usuario_id=cuenta.usuario_id and revocado_at is null;
 update public.vinculos_captura set revocado_at=coalesce(revocado_at,clock_timestamp())
  where tarjeta_id=cuenta.id and usuario_id=cuenta.usuario_id and revocado_at is null;
 return cuenta;
end $$;
revoke all on function public.archivar_cuenta(uuid) from public,anon,authenticated,service_role;
grant execute on function public.archivar_cuenta(uuid) to authenticated;
revoke all on function abaco_privado.proteger_archivo_cuenta(),abaco_privado.exigir_cuenta_activa() from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
commit;
