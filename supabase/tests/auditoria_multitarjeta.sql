-- Postflight 005: catalog and integrity only, no personal data or token hashes.
do $$
declare tabla text; firma text;
begin
 foreach tabla in array array['instrumentos_pago','vinculos_captura'] loop
  if not (select relrowsecurity from pg_class where oid=('public.'||tabla)::regclass) then raise exception 'RLS ausente: %',tabla; end if;
  if has_table_privilege('authenticated','public.'||tabla,'INSERT') or has_table_privilege('service_role','public.'||tabla,'UPDATE') then raise exception 'DML directo no autorizado: %',tabla; end if;
 end loop;
 foreach firma in array array['crear_instrumento_pago(text,text)','crear_vinculo_captura(uuid,uuid)','crear_credencial_vinculo(uuid,text)','revocar_vinculo_captura(uuid)','archivar_instrumento_pago(uuid)'] loop
  if has_function_privilege('anon','public.'||firma,'EXECUTE') or has_function_privilege('service_role','public.'||firma,'EXECUTE') or not has_function_privilege('authenticated','public.'||firma,'EXECUTE') then raise exception 'ACL incorrecta: %',firma; end if;
 end loop;
 if has_table_privilege('service_role','public.transacciones','INSERT') or has_table_privilege('service_role','public.integraciones_atajos','UPDATE') then raise exception 'service_role conserva DML'; end if;
 if exists(select 1 from public.integraciones_atajos c join public.vinculos_captura v on v.id=c.vinculo_id where c.usuario_id<>v.usuario_id or c.tarjeta_id<>v.tarjeta_id) then raise exception 'Credencial fuera de vinculo'; end if;
 if exists(select 1 from public.transacciones where version_captura=2 and vinculo_captura_id is null) then raise exception 'Captura v2 sin vinculo'; end if;
end $$;
