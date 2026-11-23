-- BENCHMARK ONLY: original full-sum body, adapted to the private 3-argument ABI.
-- Execute only in the guarded synthetic local benchmark; never deploy.
create or replace function abaco_privado.escribir_proyeccion(p_tarjeta uuid,p_delta_legacy numeric default null,p_operacion uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare estado text;cuenta public.tarjetas;m abaco_privado.libro_cuentas;base numeric;nuevo numeric;revision bigint;
begin
 estado:=abaco_privado.puerta_financiera();
 select * into strict cuenta from public.tarjetas where id=p_tarjeta for update;
 if estado='legacy' then
  if p_delta_legacy is null or p_delta_legacy::text in ('NaN','Infinity','-Infinity') then raise exception 'Delta legacy invalido';end if;
  nuevo:=coalesce(cuenta.saldo_actual,0)+p_delta_legacy;
 else
  select * into strict m from abaco_privado.libro_cuentas where tarjeta_id=p_tarjeta;
  select saldo_inicial into strict base from public.libro_aperturas where id=m.apertura_id and modo='operativo';
  select case when base is null then null else coalesce(sum(importe),0) end into nuevo
   from public.libro_apuntes where apertura_id=m.apertura_id;
  select count(*) into revision from public.libro_operaciones where apertura_id=m.apertura_id and operativa;
  insert into public.libro_proyecciones(usuario_id,tarjeta_id,apertura_id,saldo,version)
   values(m.usuario_id,m.tarjeta_id,m.apertura_id,nuevo,revision)
   on conflict(tarjeta_id) do update set saldo=excluded.saldo,version=excluded.version,actualizado_at=clock_timestamp();
 end if;
 -- The ONLY UPDATE of the compatibility balance anywhere in the installed database.
 update public.tarjetas set saldo_actual=nuevo where id=p_tarjeta and saldo_actual is distinct from nuevo;
end $$;
