import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash,createHmac} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {contextoAlojado} from './hosted-client.mjs';

const REF='bikubreyffppuxfxzxew';
const enabled=process.env.ABACO_010_HOSTED_TEST_ACK===`${REF}:archive-identified-synthetic-only`;
const ok=r=>{assert.ok(!r.error,'Solicitud de fixture rechazada; no imprimir credenciales');return r.data;};
const uuid=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/i.test(x);
function totp(secret){let bits='';for(const c of secret.toUpperCase().replace(/=+$/,''))bits+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0');const key=Buffer.from((bits.match(/.{8}/g)||[]).map(x=>parseInt(x,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',key).update(counter).digest(),o=h.at(-1)&15;return String((h.readUInt32BE(o)&0x7fffffff)%1000000).padStart(6,'0');}

test('010 alojado: archivo con JWT/TOTP reales y fixtures identificados; activacion explicita', {skip:!enabled},async t=>{
 const {admin,nuevo,sql,solicitar}=await contextoAlojado();
 // FAIL CLOSED before ANY Auth mutation. This gate currently fails: 010 is NOT installed.
 const[state]=await sql("select (select count(*)::int from supabase_migrations.schema_migrations where version='202611230010') as installed,(select modo from abaco_privado.libro_control where singleton) as mode,(select count(*)::int from cron.job where active) as cron");
 assert.deepEqual(state,{installed:1,mode:'legacy',cron:0},'Requiere 010 instalada y auditada, legacy y cron inactivo. No instalar desde este test.');
 const manifestFile=process.env.ABACO_010_FIXTURE_MANIFEST,originalFile=process.env.ABACO_010_ORIGINAL_BASELINE_FILE,output=process.env.ABACO_010_RESULT_FILE;
 assert.ok(manifestFile&&originalFile&&output,'Faltan rutas privadas de fixtures, baseline y resultados');
 const repo=fileURLToPath(new URL('../../',import.meta.url)),absolute=path.resolve(output);
 assert.ok(!absolute.toLowerCase().startsWith(repo.toLowerCase()),'Resultado privado debe quedar fuera del checkout');
 const f=JSON.parse(await readFile(manifestFile,'utf8')),original=JSON.parse(await readFile(originalFile,'utf8')).find(x=>x.tabla==='usuarios').ids;
 assert.match(f.prefix,/^TEST008-\d+$/);assert.equal(f.users.length,2);assert.equal(new Set(f.users.map(u=>u.id)).size,2);assert.equal(f.cards.length,4);
 // Exact manifest, invalid email domain, profile label and original-ID exclusion, all before mutations.
 for(const u of f.users){assert.ok(uuid(u.id)&&!original.includes(u.id));assert.ok(u.email.startsWith(f.prefix.toLowerCase()+'-')&&u.email.endsWith('@abaco-test.invalid'));assert.equal(ok(await admin.auth.admin.getUserById(u.id)).user.email,u.email);assert.equal(ok(await admin.from('usuarios').select('nombre').eq('id',u.id).single()).nombre,f.prefix+' SINTETICO');}
 for(let i=0;i<f.cards.length;i++){assert.ok(uuid(f.cards[i]));const c=ok(await admin.from('tarjetas').select('usuario_id,alias,archivado_at').eq('id',f.cards[i]).single());assert.equal(c.usuario_id,f.users[i===1?1:0].id);assert.ok(c.alias.startsWith(f.prefix+' SINTETICA '));if(i===0)assert.equal(c.archivado_at,null,'Fixture ya archivado: no reactivar ni acumular cuentas para repetir. Revisar resultados existentes.');}
 const ids=f.users.map(u=>`'${u.id}'::uuid`).join(','),tableOwners=[['usuarios','id'],['tarjetas','usuario_id'],['transacciones','usuario_id'],['integraciones_atajos','usuario_id'],['instrumentos_pago','usuario_id'],['vinculos_captura','usuario_id'],['compras_cuotas','usuario_id'],['libro_aperturas','usuario_id'],['libro_operaciones','usuario_id'],['libro_apuntes','usuario_id'],['libro_historicos_incluidos','usuario_id']];
 const preserveQuery=tableOwners.map(([name,col])=>`select '${name}' as name,count(*)::int as count,md5(coalesce(string_agg(to_jsonb(r)::text,'' order by to_jsonb(r)::text),'')) as digest from public.${name} r where r.${col} not in(${ids})`).join(' union all ');
 const sort=rows=>rows.toSorted((a,b)=>a.name.localeCompare(b.name)),before=sort(await sql(preserveQuery));
 const actors=[],createdCredentials=[],events=[],result={projectRef:REF,syntheticUsersCreated:0,syntheticUsersReused:2,newCards:0,cutover:false,steps:[]};
 let a,b,low,base;const receiptIds=[],pending=[];
 const payload=(extra={})=>({evento_id:randomUUID(),tarjetaId:f.cards[0],monto:10,moneda:'CLP',comercio:'TEST010 ALOJADO SINTETICO',fecha:new Date().toISOString(),origen:'manual',...extra});
 const balance=async()=>Number(ok(await a.client.from('tarjetas').select('saldo_actual').eq('id',f.cards[0]).single()).saldo_actual);
 const send=async(body,secret)=>{const r=await solicitar('/functions/v1/registrar-gasto-atajo',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};};
 const step=async(name,fn)=>t.test(name,async()=>{await fn();result.steps.push({name,pass:true});});
 try{
  await step('dos actores existentes, login y MFA reales; administrador AAL1 bloqueado',async()=>{
   for(const saved of f.users){const x={...saved,client:nuevo(),password:randomBytes(24).toString('hex')+'aA1!'};actors.push(x);for(const factor of ok(await admin.auth.admin.mfa.listFactors({userId:x.id})).factors)ok(await admin.auth.admin.mfa.deleteFactor({userId:x.id,id:factor.id}));ok(await admin.from('usuarios').update({rol:'usuario'}).eq('id',x.id));await sql(`delete from auth.sessions where user_id='${x.id}';delete from abaco_privado.seguridad_cuentas where usuario_id='${x.id}'`);ok(await admin.auth.admin.updateUserById(x.id,{password:x.password,ban_duration:'none'}));ok(await x.client.auth.signInWithPassword({email:x.email,password:x.password}));}
   [a,b]=actors;ok(await admin.from('usuarios').update({rol:'admin'}).eq('id',b.id));assert.equal(ok(await b.client.rpc('estado_seguridad')).permitido,false);assert.ok((await b.client.rpc('archivar_cuenta',{p_tarjeta:f.cards[1]})).error);
   for(const x of actors){const factor=ok(await x.client.auth.mfa.enroll({factorType:'totp',friendlyName:'TEST010',issuer:'Abaco staging'}));ok(await x.client.auth.mfa.challengeAndVerify({factorId:factor.id,code:totp(factor.totp.secret)}));const jwt=ok(await x.client.auth.getSession()).session.access_token;assert.equal(JSON.parse(Buffer.from(jwt.split('.')[1],'base64url')).aal,'aal2');}
   low=nuevo();ok(await low.auth.signInWithPassword({email:a.email,password:a.password}));assert.ok((await low.rpc('archivar_cuenta',{p_tarjeta:f.cards[0]})).error);assert.ok((await b.client.rpc('archivar_cuenta',{p_tarjeta:f.cards[0]})).error);assert.equal(ok(await b.client.from('tarjetas').select('id').eq('id',f.cards[0])).length,0);base=await balance();assert.ok(base>1000);
  });
  await step('v1/v2 reales: registro y pendientes idempotentes antes del archivo',async()=>{
   for(const version of[1,2]){const secret='abaco_'+randomBytes(32).toString('hex'),hash=createHash('sha256').update(secret).digest('hex');let binding;
    if(version===2){const rows=ok(await a.client.from('vinculos_captura').select('id').eq('tarjeta_id',f.cards[0]).is('revocado_at',null));assert.equal(rows.length,1);binding=rows[0].id;}
    const id=ok(await a.client.rpc(version===1?'crear_integracion_atajo':'crear_credencial_vinculo',version===1?{p_tarjeta:f.cards[0],p_hash:hash}:{p_vinculo:binding,p_hash:hash}));createdCredentials.push(id);
    const p=payload({origen:'atajo_manual'});delete p.tarjetaId;if(version===2)Object.assign(p,{version:2,binding_id:binding});events.push({secret,p});
    const rows=await Promise.all(Array.from({length:4},()=>send(p,secret)));assert.ok(rows.every(x=>x.status===201));assert.equal(new Set(rows.map(x=>x.body.data.id)).size,1);receiptIds.push(rows[0].body.data.id);
    const pp={...p,evento_id:randomUUID(),monto:100000000},prs=await Promise.all(Array.from({length:3},()=>send(pp,secret)));assert.ok(prs.every(x=>x.status===201));assert.equal(new Set(prs.map(x=>x.body.data.id)).size,1);assert.equal(prs[0].body.data.estado_revision,'pendiente');pending.push(prs[0].body.data.id);receiptIds.push(prs[0].body.data.id);
   }assert.equal(await balance(),base-20);
  });
  await step('archivo concurrente: fecha unica, saldo intacto, perfiles revocados e historial preservado',async()=>{
   const countBefore=ok(await a.client.from('transacciones').select('id').eq('tarjeta_id',f.cards[0])).length;
   const rows=await Promise.all(Array.from({length:3},()=>a.client.rpc('archivar_cuenta',{p_tarjeta:f.cards[0]})));rows.forEach(ok);const archived=rows.map(r=>Array.isArray(r.data)?r.data[0]:r.data);assert.ok(archived[0].archivado_at);assert.equal(new Set(archived.map(x=>x.archivado_at)).size,1);assert.equal(await balance(),base-20);assert.equal(ok(await a.client.from('transacciones').select('id').eq('tarjeta_id',f.cards[0])).length,countBefore);
   for(const e of events)assert.equal((await send(e.p,e.secret)).status,401);
   assert.ok((await a.client.rpc('registrar_gasto',{p_usuario:a.id,p_datos:payload(),p_token_hash:null})).error);assert.ok((await a.client.rpc('crear_integracion_atajo',{p_tarjeta:f.cards[0],p_hash:'f'.repeat(64)})).error);assert.ok((await a.client.from('tarjetas').delete().eq('id',f.cards[0])).error);assert.ok((await admin.from('tarjetas').update({archivado_at:null}).eq('id',f.cards[0])).error);assert.ok((await admin.from('tarjetas').update({saldo_actual:123}).eq('id',f.cards[0])).error);
  });
  await step('pendientes anteriores se confirman una vez con MFA; mirror legacy y sin corte',async()=>{
   for(const id of pending){assert.ok((await low.rpc('confirmar_gasto_pendiente',{p_id:id,p_monto_cuenta:10})).error);assert.ok((await b.client.rpc('confirmar_gasto_pendiente',{p_id:id,p_monto_cuenta:10})).error);const rs=await Promise.all(Array.from({length:4},()=>a.client.rpc('confirmar_gasto_pendiente',{p_id:id,p_monto_cuenta:10})));rs.forEach(ok);}assert.equal(await balance(),base-40);assert.equal(new Set(receiptIds).size,4);
   await sql(await readFile(new URL('../../supabase/tests/auditoria_libro009.sql',import.meta.url),'utf8'));await sql(await readFile(new URL('../../supabase/tests/auditoria_archivo_cuentas.sql',import.meta.url),'utf8'));
   const[s]=await sql("select modo,corte_id,(select count(*)::int from libro_aperturas where modo='operativo') as openings,(select count(*)::int from libro_proyecciones) as cache from abaco_privado.libro_control");assert.deepEqual(s,{modo:'legacy',corte_id:null,openings:0,cache:0});result.debit=40;
  });
 }finally{
  // Operator-only retirement of exactly validated synthetic actors; never API privilege escalation.
  for(const x of actors){ok(await admin.from('usuarios').update({rol:'usuario'}).eq('id',x.id));ok(await admin.auth.admin.updateUserById(x.id,{ban_duration:'876000h'}));}
  if(actors.length){const retired=actors.map(x=>`'${x.id}'::uuid`).join(',');await sql(`update integraciones_atajos set revocado_at=coalesce(revocado_at,now()) where usuario_id in(${retired}) and revocado_at is null;delete from auth.sessions where user_id in(${retired})`);const[r]=await sql(`select (select count(*)::int from auth.sessions where user_id in(${retired})) as sessions,(select count(*)::int from integraciones_atajos where usuario_id in(${retired}) and revocado_at is null) as active,(select count(*)::int from usuarios where id in(${retired}) and rol='admin') as admins`);assert.deepEqual(r,{sessions:0,active:0,admins:0});result.retired=true;}
  const after=sort(await sql(preserveQuery));result.otherOwnersPreserved=JSON.stringify(before)===JSON.stringify(after);await writeFile(absolute,JSON.stringify(result,null,2)+'\n');assert.ok(result.otherOwnersPreserved,'Datos ajenos al fixture cambiaron: detener y revisar la ventana');
 }
});
