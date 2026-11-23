begin;
alter table public.vinculos_captura add column alias text check(alias is null or length(btrim(alias)) between 1 and 80);
alter table public.integraciones_atajos add column alias text check(alias is null or length(btrim(alias)) between 1 and 80);
grant select(alias) on public.integraciones_atajos to authenticated;
create function public.renombrar_captura(p_tipo text,p_id uuid,p_alias text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform abaco_privado.exigir_acceso();perform abaco_privado.bloquear_operaciones_usuario(auth.uid());
 if p_alias is null or length(btrim(p_alias)) not between 1 and 80 then raise exception 'Alias invalido' using errcode='22023'; end if;
 case p_tipo
 when 'instrumento' then update public.instrumentos_pago set alias=btrim(p_alias) where id=p_id and usuario_id=auth.uid();
 when 'vinculo' then update public.vinculos_captura set alias=btrim(p_alias) where id=p_id and usuario_id=auth.uid();
 when 'credencial' then update public.integraciones_atajos set alias=btrim(p_alias) where id=p_id and usuario_id=auth.uid();
 else raise exception 'Tipo invalido' using errcode='22023';
 end case;
 if not found then raise exception 'Elemento no autorizado' using errcode='42501'; end if;
end $$;
revoke all on function public.renombrar_captura(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.renombrar_captura(text,uuid,text) to authenticated;
create or replace function public.crear_vinculo_captura(p_instrumento uuid,p_tarjeta uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare cuenta public.tarjetas; resultado uuid;
begin
 perform abaco_privado.exigir_acceso(); perform abaco_privado.bloquear_operaciones_usuario(auth.uid());
 if not exists(select 1 from public.instrumentos_pago where id=p_instrumento and usuario_id=auth.uid() and archivado_at is null) then
  raise exception 'Instrumento no autorizado' using errcode='42501'; end if;
 select * into cuenta from public.tarjetas where id=p_tarjeta and usuario_id=auth.uid() for update;
 if not found then raise exception 'Cuenta no autorizada' using errcode='42501'; end if;
 select id into resultado from public.vinculos_captura where usuario_id=auth.uid() and instrumento_id=p_instrumento and tarjeta_id=p_tarjeta and revocado_at is null;
 if found then return resultado; end if;
 insert into public.vinculos_captura(usuario_id,instrumento_id,tarjeta_id,moneda_cuenta,tipo_producto_cuenta)
 values(auth.uid(),p_instrumento,p_tarjeta,cuenta.moneda,cuenta.tipo_producto) returning id into resultado;
 return resultado;
end $$;
notify pgrst, 'reload schema';
commit;
