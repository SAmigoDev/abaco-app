begin isolation level repeatable read read only;
do $$declare rol text;tabla text;begin
 if not exists(select 1 from pg_attribute where attrelid='public.tarjetas'::regclass and attname='archivado_at' and atttypid='timestamptz'::regtype and not attisdropped) then raise exception 'Archivo ausente';end if;
 foreach rol in array array['anon','authenticated','service_role'] loop
  if has_column_privilege(rol,'public.tarjetas','saldo_actual','UPDATE') or has_column_privilege(rol,'public.tarjetas','archivado_at','UPDATE') or has_table_privilege(rol,'public.tarjetas','DELETE') then raise exception 'Cuenta editable de forma insegura por %',rol;end if;
  if has_function_privilege(rol,'abaco_privado.proteger_archivo_cuenta()','EXECUTE') or has_function_privilege(rol,'abaco_privado.exigir_cuenta_activa()','EXECUTE') then raise exception 'Funcion privada accesible por %',rol;end if;
 end loop;
 if not has_function_privilege('authenticated','public.archivar_cuenta(uuid)','EXECUTE') or has_function_privilege('anon','public.archivar_cuenta(uuid)','EXECUTE') or has_function_privilege('service_role','public.archivar_cuenta(uuid)','EXECUTE') then raise exception 'RPC de archivo expuesto incorrectamente';end if;
 if not exists(select 1 from pg_proc where oid='public.archivar_cuenta(uuid)'::regprocedure and proowner='postgres'::regrole and prosecdef) then raise exception 'Propietario o SECURITY DEFINER incorrecto';end if;
 foreach tabla in array array['transacciones','vinculos_captura','integraciones_atajos','compras_cuotas','movimientos_fijos'] loop
  if not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=tabla and t.tgfoid='abaco_privado.exigir_cuenta_activa()'::regprocedure and t.tgenabled='O' and not t.tgisinternal) then raise exception 'Captura sin guarda: %',tabla;end if;
 end loop;
 if exists(select 1 from public.tarjetas t where t.archivado_at is not null and
  (exists(select 1 from public.integraciones_atajos i where i.tarjeta_id=t.id and i.revocado_at is null) or exists(select 1 from public.vinculos_captura v where v.tarjeta_id=t.id and v.revocado_at is null))) then raise exception 'Cuenta archivada con perfiles activos';end if;
end $$;
commit;
