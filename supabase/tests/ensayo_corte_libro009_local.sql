-- ALL ACCOUNTS, SYNTHETIC LOCAL DATABASE ONLY. Never run on hosted Supabase.
begin;
set local lock_timeout='2s';
do $$begin
 if current_setting('abaco.libro009_local',true) is distinct from 'base-local-sintetica'
  or current_database() !~ '^abaco_it_[0-9a-f]{32}$'
  or inet_server_addr() is distinct from '127.0.0.1'::inet then raise exception 'Ensayo 009 requiere base local sintetica y confirmacion';end if;
 if (select modo from abaco_privado.libro_control where singleton)<>'legacy' then raise exception 'Ensayo requiere estado previo al corte';end if;
 perform abaco_privado.activar_libro(gen_random_uuid(),'activar-libro-con-saldos-comprometidos');
 if not abaco_privado.verificar_proyecciones() then raise exception 'Ensayo inconsistente';end if;
end $$;
-- Full rollback: no cut, opening, projection, balance or control event survives.
rollback;
