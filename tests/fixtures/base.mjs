export const fixture = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as
$$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
grant usage on schema public,auth to anon,authenticated,service_role;
grant execute on all functions in schema auth to anon,authenticated,service_role;
create table public.usuarios(id uuid primary key default gen_random_uuid(),email text unique not null,nombre text,
rol text default 'usuario',estado_suscripcion text default 'activa',fecha_vencimiento timestamptz,
regla_presupuesto_activa boolean default false,created_at timestamptz default now());
alter table public.usuarios enable row level security;
create policy propio on public.usuarios for all using(id=auth.uid());
grant select,insert,update,references on public.usuarios to anon,authenticated;
grant update(rol),insert(rol) on public.usuarios to anon,authenticated;
create table public.tarjetas(id uuid primary key default gen_random_uuid(),usuario_id uuid references public.usuarios,
alias text,moneda text,tipo_producto text,saldo_actual numeric,cupo_maximo numeric);
create table public.categorias(id uuid primary key default gen_random_uuid(),usuario_id uuid references public.usuarios);
create table public.tasas_cambio(moneda text primary key,valor numeric);
create table public.transacciones(id uuid primary key default gen_random_uuid(),usuario_id uuid references public.usuarios,
tarjeta_id uuid not null references public.tarjetas,categoria_id uuid references public.categorias,monto_original numeric not null,
moneda_original text,monto_clp numeric,comercio text,fecha timestamptz,origen text,sincronizado boolean,intentos_sync integer,
constraint transacciones_origen_check check(origen in ('regex_sms','regex_email','manual','ocr','fijo')));
create table public.compras_cuotas(id uuid primary key default gen_random_uuid(),usuario_id uuid,transaccion_id uuid,
tarjeta_id uuid,comercio text,monto_total numeric,num_cuotas integer,monto_cuota numeric,fecha_primera_cuota date,tasa_interes_mensual numeric);
grant all on public.transacciones to anon,authenticated;
create function public.actualizar_saldo_tarjeta() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger trigger_actualizar_saldo_tarjeta after insert on public.transacciones for each row execute function public.actualizar_saldo_tarjeta();
insert into usuarios(id,email) values ('00000000-0000-4000-8000-000000000001','a@test.invalid'),('00000000-0000-4000-8000-000000000002','b@test.invalid');
insert into tarjetas values
('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','Cuenta','CLP','cuenta_corriente',10000,null),
('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000002','Ajena','CLP','cuenta_corriente',10000,null);
insert into categorias values ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000002');
insert into tasas_cambio values ('USD',950);
`;
