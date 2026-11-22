begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';
do $$
declare c record; ensayo uuid; esperado numeric; obtenido numeric;
begin
 if current_setting('abaco.libro_ensayo_local',true) is distinct from 'base-local-sintetica' then
  raise exception 'Solo ensayo en base local sintetica; falta confirmacion';
 end if;
 -- Lock order matches the current RPCs: user advisory, then account rows.
 for c in select id,usuario_id from public.tarjetas order by usuario_id,id loop
  ensayo:=abaco_privado.preparar_apertura_ensayo(c.usuario_id,c.id,gen_random_uuid(),'ensayo-sin-activacion');
  select saldo_actual into esperado from public.tarjetas where id=c.id;
  select saldo_reconstruido into obtenido from public.libro_saldos_ensayo where apertura_id=ensayo;
  if esperado is distinct from obtenido or not abaco_privado.comprobar_ensayo(ensayo) then
   raise exception 'Ensayo no consistente';
  end if;
 end loop;
end $$;
-- Always discard rehearsal records; no runtime switch or activation is present.
rollback;
