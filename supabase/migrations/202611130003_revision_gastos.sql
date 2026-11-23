begin;
create function public.confirmar_gasto_pendiente(p_id uuid, p_monto_cuenta numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare gasto public.transacciones;
begin
  if auth.uid() is null then raise exception 'Sesión requerida' using errcode='42501'; end if;
  select * into gasto from public.transacciones where id=p_id and usuario_id=auth.uid() for update;
  if not found then raise exception 'Gasto no autorizado' using errcode='42501'; end if;
  if gasto.estado_revision <> 'pendiente' then return; end if;
  if p_monto_cuenta is null or p_monto_cuenta <= 0 or p_monto_cuenta >= 1000000000000
    or p_monto_cuenta::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Importe de cuenta inválido' using errcode='22023';
  end if;
  -- Explicit reconciliation only; no automatic use of another credit account.
  update public.tarjetas set saldo_actual=coalesce(saldo_actual,0) +
    case when tipo_producto='cuenta_corriente' then -p_monto_cuenta else p_monto_cuenta end
    where id=gasto.tarjeta_id and usuario_id=auth.uid();
  if not found then raise exception 'Cuenta no autorizada' using errcode='42501'; end if;
  update public.transacciones set monto_cuenta=p_monto_cuenta,estado_revision='confirmado',motivo_revision=null
    where id=p_id;
end $$;
revoke all on function public.confirmar_gasto_pendiente(uuid,numeric) from public,anon;
grant execute on function public.confirmar_gasto_pendiente(uuid,numeric) to authenticated;
commit;
