-- Read-only preflight. Run privately on a staging clone first.
select grantee,table_name,privilege_type from information_schema.table_privileges
where table_schema='public' and table_name in ('usuarios','transacciones')
order by table_name,grantee,privilege_type;
select grantee,table_name,column_name,privilege_type from information_schema.column_privileges
where table_schema='public' and table_name in ('usuarios','transacciones')
order by table_name,grantee,column_name,privilege_type;
select member::regrole,roleid::regrole from pg_auth_members
where member in ('anon'::regrole,'authenticated'::regrole);
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('usuarios','transacciones','tarjetas','categorias');
select tgname,pg_get_triggerdef(oid) from pg_trigger
where tgrelid in ('public.usuarios'::regclass,'public.transacciones'::regclass) and not tgisinternal;
select p.oid::regprocedure,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('handle_new_user','proteger_campos_suscripcion','actualizar_saldo_tarjeta');
select rol,count(*) from public.usuarios group by rol;
select count(*) as referencias_ajenas from public.transacciones t
join public.tarjetas m on m.id=t.tarjeta_id
left join public.categorias c on c.id=t.categoria_id
where m.usuario_id<>t.usuario_id or c.usuario_id<>t.usuario_id;
