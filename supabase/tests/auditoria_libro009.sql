-- Read-only, consistent catalog/data snapshot; emits no rows, credentials or personal data.
begin isolation level repeatable read read only;
do $$declare rol text;estado text;n integer;begin
 if to_regprocedure('public.actualizar_saldo_tarjeta()') is not null then raise exception 'Escritor anterior presente';end if;
 if exists(select 1 from pg_trigger where tgrelid='public.transacciones'::regclass and tgname='trigger_actualizar_saldo_tarjeta') then raise exception 'Trigger anterior presente';end if;
 select count(*) into n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname in ('public','abaco_privado') and p.prokind='f'
  and p.prosrc ~* 'update[[:space:]]+(public[.])?tarjetas[[:space:]]+set[[:space:]]+saldo_actual';
 if n<>1 then raise exception 'Numero de escritores de saldo: %',n;end if;
 if (select proowner from pg_proc where oid='abaco_privado.escribir_proyeccion(uuid,numeric,uuid)'::regprocedure)<>'abaco_financiero'::regrole then raise exception 'Propietario de proyector incorrecto';end if;
 if (select count(*) from pg_proc where proowner='abaco_financiero'::regrole)<>1 then raise exception 'Rol financiero con funciones adicionales';end if;
 if exists(select 1 from pg_roles where rolname='abaco_financiero' and (rolcanlogin or rolinherit or rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication)) then raise exception 'Rol financiero inseguro';end if;
 if exists(select 1 from pg_auth_members where roleid='abaco_financiero'::regrole and member<>'postgres'::regrole) then raise exception 'Miembro financiero no revisado';end if;
 foreach rol in array array['anon','authenticated','service_role'] loop
  if pg_has_role(rol,'abaco_financiero','MEMBER') or has_column_privilege(rol,'public.tarjetas','saldo_actual','UPDATE')
   or has_table_privilege(rol,'public.libro_proyecciones','INSERT,UPDATE,DELETE,TRUNCATE') then raise exception 'API con escritura financiera: %',rol;end if;
  if exists(select 1 from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='abaco_privado' and has_function_privilege(rol,p.oid,'EXECUTE')) then raise exception 'API ejecuta funciones privadas: %',rol;end if;
 end loop;
 if not (select relrowsecurity from pg_class where oid='public.libro_proyecciones'::regclass) then raise exception 'RLS ausente';end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='libro_proyecciones' and policyname='mfa' and permissive='RESTRICTIVE') then raise exception 'MFA no restrictivo';end if;
 if not exists(select 1 from pg_class where oid='public.libro_saldos_calculados'::regclass and reloptions @> array['security_invoker=true']) then raise exception 'Vista sin security_invoker';end if;
 select modo into strict estado from abaco_privado.libro_control where singleton;
 if estado='legacy' then
  if exists(select 1 from abaco_privado.libro_cuentas) or exists(select 1 from public.libro_proyecciones) or exists(select 1 from public.libro_aperturas where modo='operativo') then raise exception 'Activacion parcial';end if;
 elsif not abaco_privado.verificar_proyecciones() then raise exception 'Libro/proyeccion inconsistentes';end if;
end $$;
commit;
