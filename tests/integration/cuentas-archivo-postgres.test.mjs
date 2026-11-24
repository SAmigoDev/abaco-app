import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearBaseLocal, literal } from './postgres-fixture.mjs';

test('010 archivo de cuentas: historial, capturas, MFA y escritor 009', { skip: process.env.ABACO_SQL_TEST_ACK !== 'synthetic-only' }, async t => {
 const {sql,como,file,cerrar,esperar}=await crearBaseLocal();
 const a=randomUUID(),b=randomUUID(),sid=randomUUID(),sidb=randomUUID(),card=randomUUID(),other=randomUUID(),unknown=randomUUID();let aal='aal1';
 const mine=(q,opts={})=>como(q,{user:a,session:sid,aal,...opts});
 const payload=(extra={})=>({evento_id:randomUUID(),tarjetaId:card,monto:100,moneda:'CLP',comercio:'TEST010 SINTETICO',fecha:'2026-01-02T12:00:00Z',origen:'manual',...extra});
 const reg=p=>mine(`select row_to_json(r) from registrar_gasto('${a}',${literal(JSON.stringify(p))}::jsonb,null) r`).then(JSON.parse);
 const machine=(p,hash)=>como(`select row_to_json(r) from registrar_gasto(null,${literal(JSON.stringify(p))}::jsonb,'${hash}') r`,{role:'service_role'}).then(JSON.parse);
 const arch=id=>mine(`select row_to_json(r) from archivar_cuenta('${id}') r`).then(JSON.parse);
 const cardNew=async saldo=>{const id=randomUUID();await mine(`insert into tarjetas(id,usuario_id,alias,ultimos_digitos,tipo_producto,moneda,saldo_actual) values('${id}','${a}','TEST010 Cuenta','0010','cuenta_corriente','CLP',${saldo??'null'})`);return id;};
 const balance=id=>sql(`select coalesce(to_json(saldo_actual)::text,'null') from tarjetas where id='${id}'`).then(JSON.parse);
 const defs=()=>sql("select md5(string_agg(pg_get_functiondef(p.oid),'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','abaco_privado') and p.proname in('registrar_gasto','confirmar_gasto_pendiente','escribir_proyeccion')");
 let pending,historic,replay,cred1,cred2,binding,beforeDefs;
 try{
  await sql(await file('../../supabase/migrations/202611230009_escritor_financiero.sql'));
  await sql(`insert into auth.users(id,email,email_confirmed_at) values('${a}','uno010@abaco-test.invalid',now()),('${b}','dos010@abaco-test.invalid',now());insert into auth.sessions(id,user_id) values('${sid}','${a}'),('${sidb}','${b}');insert into tarjetas(id,usuario_id,alias,ultimos_digitos,tipo_producto,moneda,saldo_actual) values('${card}','${a}','TEST010 Principal','0010','cuenta_corriente','CLP',10000),('${other}','${b}','TEST010 Ajena','0011','cuenta_corriente','CLP',10000),('${unknown}','${a}','TEST010 Desconocida','0012','cuenta_corriente','USD',null)`);
  beforeDefs=await defs();const migration=await file('../../supabase/migrations/202611230010_archivo_cuentas.sql');
  await t.test('DDL NOWAIT no deja columna ni RPC parciales',async()=>{
   const lock=sql("begin;set local application_name='test010_ddl';lock table tarjetas in access share mode;select pg_sleep(1);commit;");try{await esperar("select count(*) from pg_stat_activity where datname=current_database() and application_name='test010_ddl' and wait_event='PgSleep'");await assert.rejects(sql(migration),/lock|bloque/i);assert.equal(await sql("select to_regprocedure('public.archivar_cuenta(uuid)') is null"),'t');}finally{await lock;}
  });
  await t.test('instalacion conserva NULL, saldo y funciones financieras; legacy sigue activo',async()=>{
   await sql(migration);assert.equal(await balance(card),10000);assert.equal(await balance(unknown),null);assert.equal(await defs(),beforeDefs);assert.equal(await sql('select modo from abaco_privado.libro_control'),'legacy');await sql(await file('../../supabase/tests/auditoria_libro009.sql'));await sql(await file('../../supabase/tests/auditoria_archivo_cuentas.sql'));
  });
  await t.test('edicion descriptiva con gasto concurrente no restaura saldo ni pierde NULL',async()=>{
   const p=payload();await Promise.all([reg(p),mine(`update tarjetas set alias='TEST010 Nuevo alias' where id='${card}'`)]);assert.equal(await balance(card),9900);await mine(`update tarjetas set alias='TEST010 Sin saldo' where id='${unknown}'`);assert.equal(await balance(unknown),null);await assert.rejects(mine(`update tarjetas set saldo_actual=10000 where id='${card}'`));
  });
  await t.test('v1/v2 activos conservan IDs e idempotencia antes del archivo',async()=>{
   cred1=await mine(`select crear_integracion_atajo('${card}','${'a'.repeat(64)}')`);const instrument=await mine("select crear_instrumento_pago('TEST010 Wallet','wallet')");binding=await mine(`select crear_vinculo_captura('${instrument}','${card}')`);cred2=await mine(`select crear_credencial_vinculo('${binding}','${'b'.repeat(64)}')`);
   for(const [version,hash]of[[1,'a'.repeat(64)],[2,'b'.repeat(64)]]){const p=payload({origen:'atajo_manual'});delete p.tarjetaId;if(version===2)Object.assign(p,{version:2,binding_id:binding});const rows=await Promise.all(Array.from({length:4},()=>machine(p,hash)));assert.equal(new Set(rows.map(x=>x.id)).size,1);}
   assert.equal(await balance(card),9700);replay=payload();historic=await reg(replay);pending=await reg(payload({monto:20000}));assert.equal(pending.estado_revision,'pendiente');assert.equal(await balance(card),9600);
  });
  await t.test('archivo exige propietario y MFA; flags no editables ni insertables por API',async()=>{
   await assert.rejects(como(`select archivar_cuenta('${card}')`,{user:b,session:sidb}));await assert.rejects(mine(`update tarjetas set archivado_at=now() where id='${card}'`));await assert.rejects(mine(`insert into tarjetas(usuario_id,alias,ultimos_digitos,tipo_producto,moneda,archivado_at) values('${a}','TEST010 Falsa','0000','cuenta_corriente','CLP',now())`));
   const f=randomUUID();await sql(`set role supabase_auth_admin;insert into auth.mfa_factors values('${f}','${a}','verified','totp');update auth.sessions set aal='aal2',factor_id='${f}' where id='${sid}';reset role;`);await assert.rejects(arch(card));aal='aal2';
   await assert.rejects(como(`select archivar_cuenta('${card}')`,{role:'service_role'}));
  });
  await t.test('archivo idempotente conserva movimientos y saldo; revoca solo su destino',async()=>{
   const otherCred=await mine(`select crear_integracion_atajo('${unknown}','${'c'.repeat(64)}')`);const count=await sql('select count(*) from transacciones');const rows=await Promise.all([arch(card),arch(card)]);assert.equal(rows[0].archivado_at,rows[1].archivado_at);assert.equal(await balance(card),9600);assert.equal(await sql('select count(*) from transacciones'),count);assert.equal(await sql(`select count(*) from integraciones_atajos where id in('${cred1}','${cred2}') and revocado_at is not null`),'2');assert.equal(await sql(`select revocado_at is not null from vinculos_captura where id='${binding}'`),'t');assert.equal(await sql(`select revocado_at is null from integraciones_atajos where id='${otherCred}'`),'t');
  });
  await t.test('capturas y nuevas credenciales/vinculos rechazados incluso desde SQL operador',async()=>{
   await assert.rejects(reg(payload()),/archivada/i);for(const hash of['a'.repeat(64),'b'.repeat(64)])await assert.rejects(machine(payload({origen:'atajo_manual'}),hash));await assert.rejects(mine(`select crear_integracion_atajo('${card}','${'d'.repeat(64)}')`),/archivada/i);await assert.rejects(mine(`select crear_credencial_vinculo('${binding}','${'d'.repeat(64)}')`));const i=await mine("select crear_instrumento_pago('TEST010 Otro','wallet')");await assert.rejects(mine(`select crear_vinculo_captura('${i}','${card}')`),/archivada/i);
   await assert.rejects(sql(`insert into transacciones(usuario_id,tarjeta_id,monto_original,moneda_original,monto_clp,comercio,fecha,origen) values('${a}','${card}',1,'CLP',1,'TEST010 Directa',now(),'manual')`),/archivada/i);
   await assert.rejects(mine(`insert into movimientos_fijos(usuario_id,nombre,tipo,monto,moneda,tarjeta_id,dia_cobro) values('${a}','TEST010 Fijo','gasto',1,'CLP','${card}',1)`),/archivada/i);
   assert.equal((await reg(replay)).id,historic.id);assert.equal(await balance(card),9600);
  });
  await t.test('pendientes previos se confirman una vez; historial visible, archivo irreversible y sin delete',async()=>{
   await Promise.all(Array.from({length:4},()=>mine(`select confirmar_gasto_pendiente('${pending.id}',100)`)));assert.equal(await balance(card),9500);assert.equal(await mine(`select count(*) from transacciones where id='${historic.id}'`),'1');await assert.rejects(mine(`delete from tarjetas where id='${card}'`));await assert.rejects(sql(`delete from tarjetas where id='${card}'`),/historial/i);await assert.rejects(sql(`update tarjetas set archivado_at=null where id='${card}'`),/reactiva/i);
  });
  await t.test('conexiones independientes: archivo previo bloquea captura; captura previa se conserva',async()=>{
   const c=await cardNew(1000);const archiving=mine(`set local application_name='test010_arch';select archivar_cuenta('${c}');select pg_sleep(1);`);await esperar("select count(*) from pg_stat_activity where datname=current_database() and application_name='test010_arch' and wait_event='PgSleep'");await assert.rejects(reg(payload({tarjetaId:c})),/archivada/i);await archiving;assert.equal(await balance(c),1000);await assert.rejects(sql(`delete from tarjetas where id='${c}'`),/historial/i);
   const d=await cardNew(1000),p=payload({tarjetaId:d});const capture=mine(`set local application_name='test010_capture';select registrar_gasto('${a}',${literal(JSON.stringify(p))}::jsonb,null);select pg_sleep(1);`);await esperar("select count(*) from pg_stat_activity where datname=current_database() and application_name='test010_capture' and wait_event='PgSleep'");await arch(d);await capture;assert.equal(await balance(d),900);assert.equal((await reg(p)).estado_revision,'confirmado');
  });
  await t.test('fallo tardio del archivo revierte cuenta, vinculo y credencial completos',async()=>{
   const c=await cardNew(1000),instrument=await mine("select crear_instrumento_pago('TEST010 Fallo','wallet')"),v=await mine(`select crear_vinculo_captura('${instrument}','${c}')`),credential=await mine(`select crear_credencial_vinculo('${v}','${'e'.repeat(64)}')`);
   await sql(`create function public.test010_fail() returns trigger language plpgsql as $$begin raise exception 'TEST010 fallo tardio';end $$;create trigger test010_fail before update on integraciones_atajos for each row when(old.id='${credential}'::uuid) execute function public.test010_fail();`);
   try{await assert.rejects(arch(c),/fallo tardio/);assert.equal(await sql(`select archivado_at is null from tarjetas where id='${c}'`),'t');assert.equal(await sql(`select revocado_at is null from vinculos_captura where id='${v}'`),'t');assert.equal(await sql(`select revocado_at is null from integraciones_atajos where id='${credential}'`),'t');}finally{await sql('drop trigger test010_fail on integraciones_atajos;drop function public.test010_fail()');}
  });
  await t.test('ensayo local de 009 con 010 conserva aperturas archivadas y escritor unico',async()=>{
   // Disposable LOCAL database only. No remote cutover is invoked by this suite.
   await sql(`select abaco_privado.activar_libro('${randomUUID()}','activar-libro-con-saldos-comprometidos')`);assert.equal(await balance(card),9500);assert.equal(await balance(unknown),null);const c=await cardNew(1000);await reg(payload({tarjetaId:c}));assert.equal(await balance(c),900);const previousPending=await reg(payload({tarjetaId:c,monto:20000}));assert.equal(previousPending.estado_revision,'pendiente');await arch(c);assert.equal(await balance(c),900);await Promise.all(Array.from({length:4},()=>mine(`select confirmar_gasto_pendiente('${previousPending.id}',100)`)));assert.equal(await balance(c),800);assert.equal(await sql('select abaco_privado.verificar_proyecciones()'),'t');assert.equal(await defs(),beforeDefs);await sql(await file('../../supabase/tests/auditoria_libro009.sql'));await sql(await file('../../supabase/tests/auditoria_archivo_cuentas.sql'));
  });
 }finally{await cerrar();}
});
