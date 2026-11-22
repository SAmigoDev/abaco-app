begin;
-- Only UPDATE permissions change. Account INSERT and the existing expense engine remain intact.
revoke update on public.tarjetas from public,anon,authenticated,service_role;
do $$
declare columna text; rol text;
begin
 for columna in select attname from pg_attribute where attrelid='public.tarjetas'::regclass and attnum>0 and not attisdropped loop
  foreach rol in array array['anon','authenticated','service_role'] loop
   execute format('revoke update (%I) on public.tarjetas from %I',columna,rol);
  end loop;
  execute format('revoke update (%I) on public.tarjetas from public',columna);
 end loop;
end $$;
grant update(alias,ultimos_digitos,tipo_producto,moneda,cupo_maximo,dia_corte,dia_pago) on public.tarjetas to authenticated,service_role;
do $$
begin
 if has_column_privilege('authenticated','public.tarjetas','saldo_actual','UPDATE')
 or has_column_privilege('anon','public.tarjetas','saldo_actual','UPDATE')
 or has_column_privilege('service_role','public.tarjetas','saldo_actual','UPDATE') then
  raise exception 'saldo_actual sigue siendo editable por API';
 end if;
end $$;
notify pgrst, 'reload schema';
commit;
