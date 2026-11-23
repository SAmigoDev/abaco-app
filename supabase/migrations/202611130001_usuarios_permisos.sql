begin;

-- Remove table AND column grants; a table grant overrides column restrictions.
revoke all privileges on table public.usuarios from public, anon, authenticated;
do $$
declare columnas text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into columnas
  from pg_attribute where attrelid = 'public.usuarios'::regclass
    and attnum > 0 and not attisdropped;
  execute format('revoke all privileges (%s) on public.usuarios from public, anon, authenticated', columnas);
end $$;
grant select on public.usuarios to authenticated;
grant update (nombre, regla_presupuesto_activa) on public.usuarios to authenticated;

-- Defense in depth, including callers of SECURITY DEFINER functions.
create or replace function public.proteger_campos_suscripcion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (to_jsonb(new) - array['nombre','regla_presupuesto_activa'])
     is distinct from (to_jsonb(old) - array['nombre','regla_presupuesto_activa'])
     and coalesce(auth.role(), '') <> 'service_role'
     and not (auth.uid() is null and session_user in ('postgres', 'supabase_admin')) then
    raise exception 'Solo el servidor puede modificar identidad, rol o suscripción'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.proteger_campos_suscripcion() from public, anon, authenticated;
drop trigger if exists trg_proteger_suscripcion on public.usuarios;
create trigger trg_proteger_suscripcion before update on public.usuarios
for each row execute function public.proteger_campos_suscripcion();

-- Fail migration if inherited role privileges still permit escalation.
do $$
declare columna text;
begin
  foreach columna in array array['id','email','rol','estado_suscripcion','fecha_vencimiento','created_at'] loop
    if has_column_privilege('authenticated', 'public.usuarios', columna, 'UPDATE')
      or has_column_privilege('anon', 'public.usuarios', columna, 'UPDATE') then
      raise exception 'Permiso heredado inseguro en usuarios.%', columna;
    end if;
  end loop;
end $$;
commit;
