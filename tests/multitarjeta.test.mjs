import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {fixture} from './fixtures/base.mjs';
const u='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002';
const card='00000000-0000-4000-8000-000000000011', foreign='00000000-0000-4000-8000-000000000012';
test('005: instrumentos, aislamiento, contrato v1/v2, MFA y revocacion',async t=>{
 const db=new PGlite();const q=(s,a=[])=>db.query(s,a);
 const rpc=async(name,args=[])=>{const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');return (await q(`select public.${name}(${placeholders}) as value`,args)).rows[0].value;};
 async function login(user=u,role='authenticated',aal='aal1'){
  await db.exec('reset role');
  await q("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false),set_config('request.jwt.claims',$3,false)",[user||'',role,JSON.stringify({sub:user,role,aal,session_id:user===other?'00000000-0000-4000-8000-000000000102':'00000000-0000-4000-8000-000000000101'})]);
  await db.exec(`set role ${role}`);
 }
 const payload=(extra={})=>({evento_id:crypto.randomUUID(),monto:100,moneda:'CLP',comercio:'Ficticio',fecha:'2026-01-02T12:00:00Z',origen:'atajo_manual',...extra});
 const send=async(p,h)=>(await q('select row_to_json(t) as value from public.registrar_gasto(null,$1::jsonb,$2) t',[JSON.stringify(p),h])).rows[0].value;
 try {
  await db.exec(fixture+await readFile(new URL('./fixtures/auth-multitarjeta.sql',import.meta.url),'utf8'));
  for(const f of ['202611130001_usuarios_permisos.sql','202611130002_registro_atajos.sql','202611130003_revision_gastos.sql','202611130004_auth_mfa.sql','202611190005_instrumentos_vinculos.sql','202611190006_alias_captura.sql']) await db.exec(await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
  await login();
  const instrument=await rpc('crear_instrumento_pago',['Wallet ficticio','wallet']);
  const binding=await rpc('crear_vinculo_captura',[instrument,card]);
  const instrument2=await rpc('crear_instrumento_pago',['Fisica ficticia','fisica']);
  const binding2=await rpc('crear_vinculo_captura',[instrument2,card]);
  const h='b'.repeat(64),h2='c'.repeat(64),legacy='a'.repeat(64);
  const credential=await rpc('crear_credencial_vinculo',[binding,h]);
  await rpc('crear_credencial_vinculo',[binding2,h2]);await rpc('crear_integracion_atajo',[card,legacy]);
  await t.test('006: renombrar conserva identidad/destino y alta repetida devuelve mismo vinculo',async()=>{
   assert.equal(await rpc('crear_vinculo_captura',[instrument,card]),binding);
   for(const [tipo,id] of [['instrumento',instrument],['vinculo',binding],['credencial',credential]]) await rpc('renombrar_captura',[tipo,id,'Alias descriptivo']);
   assert.equal((await q('select tarjeta_id from vinculos_captura where id=$1',[binding])).rows[0].tarjeta_id,card);
   assert.equal((await q('select alias from integraciones_atajos where id=$1',[credential])).rows[0].alias,'Alias descriptivo');
   await assert.rejects(rpc('renombrar_captura',['vinculo',binding,' ']),/Alias invalido/);
  });
  await t.test('rechaza cuenta ajena y metadatos ajenos; admin AAL1 no gestiona',async()=>{
   await assert.rejects(rpc('crear_vinculo_captura',[instrument,foreign]),/Cuenta no autorizada/);
   await login(other);assert.equal((await q('select * from instrumentos_pago')).rows.length,0);
   await assert.rejects(rpc('crear_credencial_vinculo',[binding,'d'.repeat(64)]),/verificaci/);
   await db.exec("reset role;select set_config('request.jwt.claim.role','service_role',false)");await q("update usuarios set rol='usuario' where id=$1",[other]);
   await login(other);assert.equal((await q('select * from vinculos_captura')).rows.length,0);
   await assert.rejects(rpc('crear_credencial_vinculo',[binding,'d'.repeat(64)]),/Vinculo no autorizado/);
   await assert.rejects(rpc('revocar_vinculo_captura',[binding]),/Vinculo no autorizado/);
   await assert.rejects(rpc('crear_vinculo_captura',[instrument,foreign]),/Instrumento no autorizado/);
   await assert.rejects(rpc('renombrar_captura',['vinculo',binding,'Ajeno']),/no autorizado/);
   await login();
  });
  await t.test('vinculo y credencial no se pueden reasignar ni con DML privilegiado',async()=>{
   await db.exec('reset role');
   await assert.rejects(q('update vinculos_captura set instrumento_id=$1 where id=$2',[instrument2,binding]),/inmutable/);
   await assert.rejects(q('update integraciones_atajos set vinculo_id=$1 where id=$2',[binding2,credential]),/inmutables/);
   await assert.rejects(q("update tarjetas set moneda='USD' where id=$1",[card]),/foreign key/);
  });
  await t.test('v1 existente funciona; v2 repite una fila y no cambia de vinculo',async()=>{
   await login(null,'service_role');
   const old=payload();const first=await send(old,legacy);assert.equal((await send(old,legacy)).id,first.id);
   const p=payload({version:2,binding_id:binding});const row=await send(p,h);
   assert.equal(row.vinculo_captura_id,binding);assert.equal(row.version_captura,2);
   assert.equal((await send(p,h)).id,row.id);
   await assert.rejects(send({...p,binding_id:binding2},h2),/otro vinculo/);
   await assert.rejects(send(payload({version:2,binding_id:binding2}),h),/no autorizado/);
   await assert.rejects(send(payload({version:2,binding_id:binding,monto:'100'}),h),/Contrato/);
   await assert.rejects(send(payload({version:2,binding_id:binding}),legacy),/no autorizado/);
   await assert.rejects(q('update integraciones_atajos set revocado_at=now()'),/permission denied/);
   await assert.rejects(rpc('crear_instrumento_pago',['No','wallet']),/permission denied/);
  });
  await t.test('revocar vinculo invalida tambien reintentos, conserva otro vinculo y v1',async()=>{
   const p=payload({version:2,binding_id:binding});await login(null,'service_role');await send(p,h);
   await login();await rpc('revocar_vinculo_captura',[binding]);await rpc('revocar_vinculo_captura',[binding]);
   await login(null,'service_role');await assert.rejects(send(p,h),/Credencial invalida/);
   await send(payload({version:2,binding_id:binding2}),h2);await send(payload(),legacy);
   await login();await rpc('archivar_instrumento_pago',[instrument2]);
   await login(null,'service_role');await assert.rejects(send(payload({version:2,binding_id:binding2}),h2),/Credencial invalida/);
   await db.exec('reset role');await assert.rejects(q('update vinculos_captura set revocado_at=null where id=$1',[binding]),/reactiva/);
  });
  await t.test('MFA activado bloquea tablas y RPC nuevas en AAL1',async()=>{
   await db.exec('reset role');await q("insert into auth.mfa_factors values(gen_random_uuid(),$1,'verified','totp')",[u]);
   await login();assert.equal((await q('select * from vinculos_captura')).rows.length,0);
   await assert.rejects(rpc('crear_instrumento_pago',['Bloqueado','wallet']),/verificaci/);
   await assert.rejects(rpc('renombrar_captura',['instrumento',instrument,'Sin MFA']),/verificaci/);
  });
 } finally {await db.close();}
});
