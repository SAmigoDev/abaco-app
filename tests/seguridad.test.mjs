import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { fixture } from './fixtures/base.mjs';
import { destinoSeguro, destinoAutenticado } from '../src/lib/auth/rutas.mjs';

const usuario='00000000-0000-4000-8000-000000000001';
const admin='00000000-0000-4000-8000-000000000002';
const tarjeta='00000000-0000-4000-8000-000000000011';
const sesion1='00000000-0000-4000-8000-000000000101';
const sesion2='00000000-0000-4000-8000-000000000102';
const factor='00000000-0000-4000-8000-000000000201';
const heredado='00000000-0000-4000-8000-000000000003';
const sesion3='00000000-0000-4000-8000-000000000103';
const extension=`
create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
insert into public.usuarios(id,email) values('${heredado}','heredado@test.invalid');
insert into auth.users select id,now() from public.usuarios;
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,aal text default 'aal1',factor_id uuid);
insert into auth.sessions(id,user_id) values ('${sesion1}','${usuario}'),('${sesion2}','${admin}'),('${sesion3}','${heredado}');
create table auth.mfa_factors(id uuid primary key,user_id uuid references auth.users,status text,factor_type text default 'totp');
insert into auth.mfa_factors(id,user_id,status) values(gen_random_uuid(),'${heredado}','verified');
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create table public.metas_ahorro(id uuid primary key,usuario_id uuid);
create table public.movimientos_fijos(id uuid primary key,usuario_id uuid);
create table public.logs(id uuid primary key,evento text);
create table public.regex_rules(id uuid primary key default gen_random_uuid(),version integer,activa boolean);
create function public.version_global_regex_rules() returns integer language sql stable as $$ select coalesce(sum(version),0)::integer from public.regex_rules where activa $$;
create function public.get_regex_version_global() returns bigint language sql stable as $$ select coalesce(sum(version),0) from public.regex_rules where activa $$;
update usuarios set rol='admin' where id='${admin}';
insert into public.logs values(gen_random_uuid(),'privado');
insert into public.regex_rules(version,activa) values(1,true);
do $$ declare tabla text; begin
foreach tabla in array array['tarjetas','categorias','transacciones','compras_cuotas','metas_ahorro','movimientos_fijos'] loop
 execute format('alter table public.%I enable row level security',tabla);
 execute format('create policy propio on public.%I for all to authenticated using(usuario_id=auth.uid())',tabla);
 execute format('grant select on public.%I to authenticated',tabla);
end loop;
end $$;
grant update on tarjetas to authenticated;
alter table logs enable row level security;
create policy admin_logs on logs for select to authenticated using(exists(select 1 from usuarios where id=auth.uid() and rol='admin'));
grant select on logs to authenticated;
alter table regex_rules enable row level security;
alter table tasas_cambio enable row level security;
create policy lectura on regex_rules for select using(true);
create policy lectura on tasas_cambio for select using(true);
create policy admin_reglas on regex_rules for all using(exists(select 1 from usuarios where id=auth.uid() and rol='admin'));
create policy admin_tasas on tasas_cambio for all using(exists(select 1 from usuarios where id=auth.uid() and rol='admin'));
grant all on regex_rules,tasas_cambio to authenticated;
`;

test('destinos de acceso son internos, acotados y sin bucles', () => {
  for (const value of ['https://evil.invalid','//evil.invalid','/\\evil.invalid','/%2f%2fevil.invalid','/auth/callback','/login','/auth/mfa','/registrar?next=https://evil.invalid','/configuracion/../auth/callback',null,['/configuracion']]) assert.equal(destinoSeguro(value),'/');
  assert.equal(destinoSeguro('/configuracion'),'/configuracion');
  assert.equal(destinoAutenticado(null),'/login');
  assert.equal(destinoAutenticado({autenticado:true,correo_confirmado:true,requiere_mfa:true,permitido:false},'/auth/actualizar-clave'),'/auth/mfa?next=%2Fauth%2Factualizar-clave');
  assert.equal(destinoAutenticado({autenticado:true,correo_confirmado:true,permitido:true},'/registrar'),'/registrar');
});

test('API PostgreSQL: RLS, RPC, administradores, pérdida de factores y Atajos',async t=>{
  const db=new PGlite();
  try {
    await db.exec(fixture+extension);
    for (const file of ['202611130001_usuarios_permisos.sql','202611130002_registro_atajos.sql','202611130003_revision_gastos.sql','202611130004_auth_mfa.sql']) await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    const query=(sql,args=[])=>db.query(sql,args);
    async function login(uid=usuario,aal='aal1',rol='authenticated',nivelSesion=aal) {
      await db.exec('reset role');
      if(uid) await query("update auth.sessions set aal=$1,factor_id=case when $1='aal2' then (select id from auth.mfa_factors where user_id=$2 and status='verified' and factor_type='totp' limit 1) else null end where user_id=$2",[nivelSesion,uid]);
      await query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false),set_config('request.jwt.claims',$3,false)",[
        uid||'',rol,JSON.stringify({sub:uid,role:rol,aal,session_id:uid===admin?sesion2:uid===heredado?sesion3:sesion1})]);
      await db.exec(`set role ${rol}`);
    }
    const estado=async()=>(await query('select estado_seguridad() as estado')).rows[0].estado;
    const datos=(overrides={})=>({evento_id:crypto.randomUUID(),tarjetaId:tarjeta,monto:100,moneda:'CLP',comercio:'API directa',fecha:'2026-01-02T12:00:00Z',origen:'manual',...overrides});
    const registrar=(payload,uid=usuario,hash=null)=>query('select (registrar_gasto($1,$2::jsonb,$3)).*',[uid,JSON.stringify(payload),hash]);
    await t.test('factores anteriores al despliegue quedan protegidos aunque se eliminen después',async()=>{
      await login(heredado);assert.equal((await estado()).requiere_mfa,true);assert.equal((await estado()).permitido,false);
      await login(heredado,'aal2');assert.equal((await estado()).permitido,true);
      await db.exec('reset role');await query('delete from auth.mfa_factors where user_id=$1',[heredado]);
      await login(heredado);assert.equal((await estado()).requiere_mfa,true);assert.equal((await estado()).permitido,false);
    });
    await t.test('usuario sin factor confirmado usa AAL1; anónimo y correo no confirmado no acceden',async()=>{
      await login(); assert.equal((await estado()).permitido,true);
      assert.equal((await query('select * from tarjetas')).rows.length,1);
      await registrar(datos());
      await login(null,'aal1','anon');
      await assert.rejects(query('select estado_seguridad()'),/permission denied/);
      await db.exec('reset role'); await query('update auth.users set email_confirmed_at=null where id=$1',[usuario]);
      await login(); assert.equal((await estado()).permitido,false);
      assert.equal((await query('select * from tarjetas')).rows.length,0);
      await assert.rejects(registrar(datos()),/verificación/);
      await db.exec('reset role'); await query('update auth.users set email_confirmed_at=now() where id=$1',[usuario]);
    });
    await t.test('admin existente sin factor solo recibe estado mínimo para configurar MFA',async()=>{
      await login(admin); const info=await estado();
      assert.equal(info.administrador,true);assert.equal(info.requiere_mfa,true);assert.equal(info.permitido,false);
      assert.equal((await query('select * from usuarios')).rows.length,0);
      assert.equal((await query('select * from logs')).rows.length,0);
      assert.equal((await query('update regex_rules set version=2 returning id')).rows.length,0);
      await assert.rejects(query('select crear_integracion_atajo($1,$2)',['00000000-0000-4000-8000-000000000012','a'.repeat(64)]),/verificación/);
      await db.exec('reset role'); await query("insert into auth.mfa_factors(id,user_id,status) values(gen_random_uuid(),$1,'verified')",[admin]);
      await login(admin,'aal1');assert.equal((await estado()).permitido,false);
      await login(admin,'aal2');assert.equal((await estado()).permitido,true);
      assert.equal((await query('select * from logs')).rows.length,1);
      assert.equal((await query('update regex_rules set version=2 returning id')).rows.length,1);
    });
    let integracion;
    await t.test('factor no confirmado no activa MFA; primer factor confirmado bloquea las sesiones AAL1',async()=>{
      await db.exec('reset role'); await query("insert into auth.mfa_factors(id,user_id,status) values($1,$2,'unverified')",[factor,usuario]);
      await login(); assert.equal((await estado()).requiere_mfa,false);
      integracion=(await query('select crear_integracion_atajo($1,$2) as id',[tarjeta,'b'.repeat(64)])).rows[0].id;
      await db.exec('reset role');await query("update auth.mfa_factors set status='verified' where id=$1",[factor]);
      await login();assert.equal((await estado()).permitido,false);
      for(const table of ['usuarios','tarjetas','transacciones','categorias','compras_cuotas','metas_ahorro','movimientos_fijos','integraciones_atajos','logs','regex_rules','tasas_cambio']) assert.equal((await query(`select ${table==='integraciones_atajos'?'id':'*'} from ${table}`)).rows.length,0,table);
      for(const op of [()=>registrar(datos()),()=>query('select crear_integracion_atajo($1,$2)',[tarjeta,'c'.repeat(64)]),()=>query('select revocar_integracion_atajo($1)',[integracion]),()=>query('select confirmar_gasto_pendiente(gen_random_uuid(),1)')]) await assert.rejects(op(),/verificación/);
      assert.equal((await query('update tarjetas set saldo_actual=5 returning id')).rows.length,0);
    });
    await t.test('AAL2 habilita operaciones propias; service_role no acepta registros web',async()=>{
      await login(usuario,'aal2');assert.equal((await estado()).permitido,true);
      await login(usuario,'aal2','authenticated','aal1');assert.equal((await estado()).permitido,false); // stale JWT after Auth downgrade
      await login(usuario,'aal2');
      const pendiente=(await registrar(datos({monto:20000}))).rows[0];
      await query('select confirmar_gasto_pendiente($1,20000)',[pendiente.id]);
      await assert.rejects(registrar(datos(),admin),/no autorizado/);
      await assert.rejects(query('select abaco_privado.registrar_gasto($1,$2::jsonb,null)',[usuario,JSON.stringify(datos())]),/permission denied/);
      await login(null,'aal1','service_role');
      await assert.rejects(registrar(datos()),/verificación/);
      await assert.rejects(query('select crear_integracion_atajo($1,$2)',[tarjeta,'d'.repeat(64)]),/permission denied/);
    });
    await t.test('Atajo existente continúa con alcance fijo sin gestionar cuenta, aun con usuario bloqueado',async()=>{
      await login(null,'aal1','service_role');
      const payload=datos({tarjetaId:undefined,origen:'atajo_manual'});
      const a=(await registrar(payload,null,'b'.repeat(64))).rows[0];
      const b=(await registrar(payload,null,'b'.repeat(64))).rows[0];
      assert.equal(a.id,b.id);assert.equal(a.usuario_id,usuario);assert.equal(a.tarjeta_id,tarjeta);
      await assert.rejects(registrar(datos(),null,'b'.repeat(64)),/Origen inválido/);
      await assert.rejects(registrar(payload,null,'f'.repeat(64)),/Credencial inválida/);
      await login(usuario,'aal2');await query('select revocar_integracion_atajo($1)',[integracion]);
      await login(null,'aal1','service_role');await assert.rejects(registrar(payload,null,'b'.repeat(64)),/Credencial inválida/);
    });
    await t.test('recuperación de contraseña, borrado del último factor y sesión revocada no evitan MFA',async()=>{
      await login(usuario,'aal1');assert.equal((await estado()).permitido,false); // recovery session
      await db.exec('reset role');await query('delete from auth.mfa_factors where user_id=$1',[usuario]);
      await login(usuario,'aal1');assert.equal((await estado()).requiere_mfa,true);assert.equal((await estado()).permitido,false);
      await login(usuario,'aal2');assert.equal((await estado()).permitido,false); // stale aal2 without factors
      await db.exec('reset role');await query("insert into auth.mfa_factors values($1,$2,'verified','totp')",[factor,usuario]);
      await login(usuario,'aal2');assert.equal((await estado()).permitido,true);
      await db.exec('reset role');await query('delete from auth.sessions where id=$1',[sesion1]);
      await login(usuario,'aal2');assert.equal((await estado()).permitido,false);
    });
  } finally {await db.close();}
});
