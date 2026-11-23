begin;

-- Not exposed in the Data API. Persist opt-in even if Auth factors are removed.
create schema if not exists abaco_privado;
revoke all on schema abaco_privado from public, anon, authenticated, service_role;
create table abaco_privado.seguridad_cuentas (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  mfa_activado boolean not null default true,
  activado_at timestamptz not null default now()
);
alter table abaco_privado.seguridad_cuentas enable row level security;
revoke all on abaco_privado.seguridad_cuentas from public,anon,authenticated,service_role;
insert into abaco_privado.seguridad_cuentas(usuario_id)
  select distinct user_id from auth.mfa_factors where status='verified';

create function abaco_privado.recordar_mfa()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='verified' then
    insert into abaco_privado.seguridad_cuentas(usuario_id) values(new.user_id)
      on conflict(usuario_id) do update set mfa_activado=true;
  end if;
  return new;
end $$;
revoke all on function abaco_privado.recordar_mfa() from public,anon,authenticated,service_role;
create trigger abaco_recordar_mfa after insert or update of status on auth.mfa_factors
for each row execute function abaco_privado.recordar_mfa();

-- Minimal bootstrap data only. AAL1 admins can enroll through Auth, not read profiles.
create function public.estado_seguridad()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  confirmado boolean;
  sesion boolean;
  nivel_sesion text;
  factor_sesion uuid;
  administrador boolean;
  factor boolean;
  obligatorio boolean;
  permitido boolean;
begin
  select email_confirmed_at is not null into confirmado from auth.users where id=uid;
  select s.aal::text,s.factor_id into nivel_sesion,factor_sesion from auth.sessions s where s.user_id=uid and s.id::text=auth.jwt()->>'session_id';
  sesion := found;
  select exists(select 1 from public.usuarios where id=uid and rol='admin') into administrador;
  select exists(select 1 from auth.mfa_factors where user_id=uid and status='verified' and factor_type='totp') into factor;
  obligatorio := administrador or factor or exists(select 1 from abaco_privado.seguridad_cuentas where usuario_id=uid and mfa_activado);
  permitido := coalesce(confirmado,false) and sesion and coalesce(auth.jwt()->>'is_anonymous','false')='false'
    and (not obligatorio or (auth.jwt()->>'aal'='aal2' and nivel_sesion='aal2' and exists(
      select 1 from auth.mfa_factors where id=factor_sesion and user_id=uid and status='verified' and factor_type='totp')));
  return jsonb_build_object('autenticado',uid is not null and sesion,
    'correo_confirmado',coalesce(confirmado,false),'requiere_mfa',obligatorio,
    'tiene_factor',factor,'permitido',coalesce(permitido,false),'administrador',administrador);
end $$;
revoke all on function public.estado_seguridad() from public,anon,service_role;
grant execute on function public.estado_seguridad() to authenticated;

create function public.acceso_protegido()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((public.estado_seguridad()->>'permitido')::boolean,false);
$$;
revoke all on function public.acceso_protegido() from public,anon,service_role;
grant execute on function public.acceso_protegido() to authenticated;
create function abaco_privado.exigir_acceso()
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.acceso_protegido() then
    raise exception 'Completa la verificación de correo y MFA requerida' using errcode='42501';
  end if;
end $$;
revoke all on function abaco_privado.exigir_acceso() from public,anon,authenticated,service_role;

-- RESTRICTIVE combines with existing owner/admin policies, never replaces them.
do $$
declare tabla text;
begin
  foreach tabla in array array['usuarios','categorias','tarjetas','transacciones','compras_cuotas',
    'metas_ahorro','movimientos_fijos','logs','regex_rules','tasas_cambio','integraciones_atajos'] loop
    execute format('create policy abaco_exigir_mfa on public.%I as restrictive for all to authenticated using ((select public.acceso_protegido())) with check ((select public.acceso_protegido()))',tabla);
  end loop;
end $$;

-- Rename and hide previous SECURITY DEFINER engines. No exposed unguarded aliases.
alter function public.crear_integracion_atajo(uuid,text) set schema abaco_privado;
alter function public.revocar_integracion_atajo(uuid) set schema abaco_privado;
alter function public.confirmar_gasto_pendiente(uuid,numeric) set schema abaco_privado;
alter function public.registrar_gasto(uuid,jsonb,text) set schema abaco_privado;
revoke all on all functions in schema abaco_privado from public,anon,authenticated,service_role;

create function public.crear_integracion_atajo(p_tarjeta uuid,p_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform abaco_privado.exigir_acceso();
  return abaco_privado.crear_integracion_atajo(p_tarjeta,p_hash);
end $$;
create function public.revocar_integracion_atajo(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform abaco_privado.exigir_acceso();
  perform abaco_privado.revocar_integracion_atajo(p_id);
end $$;
create function public.confirmar_gasto_pendiente(p_id uuid,p_monto_cuenta numeric)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform abaco_privado.exigir_acceso();
  perform abaco_privado.confirmar_gasto_pendiente(p_id,p_monto_cuenta);
end $$;
create function public.registrar_gasto(p_usuario uuid,p_datos jsonb,p_token_hash text default null)
returns public.transacciones language plpgsql security definer set search_path='' as $$
begin
  if auth.role()='service_role' and p_token_hash is not null and p_usuario is null then
    -- Dedicated automation credential only. Internal engine fixes owner/account and validates hash.
    return abaco_privado.registrar_gasto(null,p_datos,p_token_hash);
  end if;
  perform abaco_privado.exigir_acceso();
  if auth.role()<>'authenticated' or p_usuario is distinct from auth.uid() or p_token_hash is not null then
    raise exception 'Registro no autorizado' using errcode='42501';
  end if;
  return abaco_privado.registrar_gasto(auth.uid(),p_datos,null);
end $$;
revoke all on function public.crear_integracion_atajo(uuid,text), public.revocar_integracion_atajo(uuid),
  public.confirmar_gasto_pendiente(uuid,numeric), public.registrar_gasto(uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.crear_integracion_atajo(uuid,text), public.revocar_integracion_atajo(uuid),
  public.confirmar_gasto_pendiente(uuid,numeric), public.registrar_gasto(uuid,jsonb,text) to authenticated;
grant execute on function public.registrar_gasto(uuid,jsonb,text) to service_role;

-- Existing cache-version RPCs must respect RLS; keep their original result types.
alter function public.version_global_regex_rules() security invoker;
alter function public.get_regex_version_global() security invoker;
revoke all on function public.version_global_regex_rules(),public.get_regex_version_global() from public,anon,service_role;
grant execute on function public.version_global_regex_rules(),public.get_regex_version_global() to authenticated;
commit;
