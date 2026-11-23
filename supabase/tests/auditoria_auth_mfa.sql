-- Read-only staging preflight for migration 004. Do not output secrets or JWTs.
select table_name,column_name,data_type,udt_name from information_schema.columns
where table_schema='auth' and table_name in ('users','sessions','mfa_factors')
  and column_name in ('id','user_id','email_confirmed_at','aal','factor_id','status','factor_type')
order by table_name,ordinal_position;
select rol,count(*) as usuarios,
  count(*) filter(where exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.status='verified' and f.factor_type='totp')) as con_totp
from public.usuarios u group by rol;
select factor_type,status,count(*) from auth.mfa_factors group by factor_type,status;
select n.nspname,p.oid::regprocedure,p.prosecdef,p.proconfig,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','abaco_privado') order by n.nspname,p.proname;
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
where schemaname in ('public','abaco_privado') order by tablename,policyname;
select tgname,pg_get_triggerdef(oid) from pg_trigger where tgrelid='auth.mfa_factors'::regclass and not tgisinternal;
