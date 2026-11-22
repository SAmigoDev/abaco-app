import{test}from'node:test';import assert from'node:assert/strict';import{randomUUID,randomBytes,createHash,createHmac}from'node:crypto';import{readFile,writeFile}from'node:fs/promises';import{contextoAlojado}from'./hosted-client.mjs';
const enabled=process.env.ABACO_008_OPERATIONAL_TEST_ACK==='bikubreyffppuxfxzxew:identified-synthetic-only';
const ok=r=>{assert.ok(!r.error,'Operacion sintetica fallida; no imprimir credenciales');return r.data;};
function codigo(secret){let bits='';for(const c of secret.replace(/=+$/,'').toUpperCase())bits+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0');const key=Buffer.from((bits.match(/.{8}/g)||[]).map(v=>parseInt(v,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const hash=createHmac('sha1',key).update(counter).digest(),off=hash.at(-1)&15;return String((hash.readUInt32BE(off)&0x7fffffff)%1000000).padStart(6,'0');}
test('008 Supabase staging operativo: fixtures sinteticos identificados, JWT/TOTP reales',{skip:!enabled},async t=>{
 const {admin,nuevo,sql,solicitar}=await contextoAlojado();
 assert.equal((await sql("select version from supabase_migrations.schema_migrations where version='202611220008'")).length,1);
 const reuse=process.env.ABACO_008_REUSE_MANIFEST?JSON.parse(await readFile(process.env.ABACO_008_REUSE_MANIFEST,'utf8')):null;
 const prefix=reuse?.prefix||'TEST008-'+Date.now(),actors=[],cards=new Set(),books=new Set(),credentials=[];
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(reuse){
  assert.match(prefix,/^TEST008-\d+$/);assert.equal(reuse.users.length,2);assert.equal(new Set(reuse.users.map(x=>x.id)).size,2);
  const baseline=JSON.parse(await readFile(process.env.ABACO_008_ORIGINAL_BASELINE,'utf8'));
  const original=baseline.find(x=>x.tabla==='usuarios').ids;
  for(const x of reuse.users){assert.match(x.id,uuid);assert.ok(x.email.startsWith(prefix.toLowerCase()+'-')&&x.email.endsWith('@abaco-test.invalid'));assert.ok(!original.includes(x.id));
   const user=ok(await admin.auth.admin.getUserById(x.id)).user;assert.equal(user.email,x.email);
   const profile=ok(await admin.from('usuarios').select('nombre').eq('id',x.id).single());assert.equal(profile.nombre,prefix+' SINTETICO');
  }
  assert.equal(reuse.cards.length,4);assert.equal(new Set(reuse.cards).size,4);
  for(const id of reuse.cards){assert.match(id,uuid);const card=ok(await admin.from('tarjetas').select('usuario_id,alias').eq('id',id).single());assert.equal(card.usuario_id,reuse.users[reuse.cards.indexOf(id)===1?1:0].id);assert.ok(card.alias.startsWith(prefix+' SINTETICA '));cards.add(id);}
 }
 let actorIndex=0;
 const save=()=>writeFile(process.env.ABACO_008_RESULT_MANIFEST||'C:/Users/tatan/Documents/Codex/2026-11-13/esd/work/staging-private/008-sinteticos.json',JSON.stringify({prefix,users:actors.map(x=>({id:x.id,email:x.email})),cards:[...cards],books:[...books],credentials},null,2));
 const actor=async()=>{
  const saved=reuse?.users[actorIndex++],email=saved?.email||prefix.toLowerCase()+'-'+randomUUID()+'@abaco-test.invalid',password=randomBytes(24).toString('hex')+'aA1!';
  const user=saved?{id:saved.id}:ok(await admin.auth.admin.createUser({email,password,email_confirm:true})).user;
  const client=nuevo(),x={id:user.id,email,password,client};actors.push(x);await save();
  if(saved){
   // Test-fixture reset only: exact manifest + .invalid email + original-ID exclusion checked above.
   // This operator-only path is NOT account recovery and must never be used for real users.
   for(const factor of ok(await admin.auth.admin.mfa.listFactors({userId:x.id})).factors)ok(await admin.auth.admin.mfa.deleteFactor({userId:x.id,id:factor.id}));
   ok(await admin.from('usuarios').update({rol:'usuario'}).eq('id',x.id));
   await sql(`delete from auth.sessions where user_id='${x.id}';delete from abaco_privado.seguridad_cuentas where usuario_id='${x.id}'`);
   ok(await admin.auth.admin.updateUserById(x.id,{password,ban_duration:'none'}));
  }
  ok(await client.auth.signInWithPassword({email,password}));ok(await client.from('usuarios').update({nombre:prefix+' SINTETICO'}).eq('id',x.id));await save();return x;
 };
 const cuenta=async(a,saldo,moneda='CLP')=>{const row=ok(await a.client.from('tarjetas').insert({usuario_id:a.id,alias:prefix+' SINTETICA '+(cards.size+1),ultimos_digitos:'0000',moneda,tipo_producto:'cuenta_corriente',saldo_actual:saldo}).select('id').single());cards.add(row.id);await save();return row.id;};
 const apertura=async(a,c,key=randomUUID())=>{
  assert.ok(cards.has(c));
  if(reuse){const row=ok(await a.client.from('libro_aperturas').select('id,solicitud_id').eq('tarjeta_id',c).single());assert.ok(reuse.books.includes(row.id));key=row.solicitud_id;}
  const [r]=await sql(`select abaco_privado.preparar_apertura_ensayo('${a.id}','${c}','${key}','ensayo-sin-activacion') as id`);books.add(r.id);await save();return r.id;
 };
 const payload=(c,extra={})=>({evento_id:randomUUID(),tarjetaId:c,monto:100,moneda:'CLP',comercio:prefix,fecha:new Date().toISOString(),origen:'manual',...extra});
 const gasto=async(a,p)=>ok(await a.client.rpc('registrar_gasto',{p_usuario:a.id,p_datos:p,p_token_hash:null}));
 const balance=async(a,c)=>ok(await a.client.from('tarjetas').select('saldo_actual').eq('id',c).single()).saldo_actual;
 let a,b,c,cb,book,old,aperturaB,startBalance;
 try{
  await t.test('apertura de saldo neto conserva historia, desconocido y repeticiones',async()=>{
   a=await actor();b=await actor();c=reuse?reuse.cards[0]:await cuenta(a,10000);cb=reuse?reuse.cards[1]:await cuenta(b,20000);
   let p;
   if(reuse){
    const history=ok(await a.client.from('libro_historicos_incluidos').select('transaccion_id').eq('tarjeta_id',c));assert.equal(history.length,1);
    old=ok(await a.client.from('transacciones').select('*').eq('id',history[0].transaccion_id).single());
    p=payload(c,{evento_id:old.evento_id,monto:old.monto_original,moneda:old.moneda_original,comercio:old.comercio,fecha:old.fecha,origen:old.origen});
   }else{p=payload(c);old=await gasto(a,p);assert.equal(await balance(a,c),9900);}
   startBalance=await balance(a,c);
   const key=randomUUID(),ids=await Promise.all(Array.from({length:4},()=>apertura(a,c,key)));assert.equal(new Set(ids).size,1);book=ids[0];aperturaB=await apertura(b,cb);
   assert.equal(ok(await a.client.from('libro_aperturas').select('saldo_inicial').eq('id',book).single()).saldo_inicial,9900);
   assert.equal(ok(await a.client.from('libro_historicos_incluidos').select('transaccion_id').eq('apertura_id',book)).length,1);
   assert.equal((await gasto(a,p)).id,old.id);assert.equal(await balance(a,c),startBalance);
   // Catch up only missing post-opening synthetic receipts; no rewriting snapshots or balances.
   const receipts=ok(await a.client.from('transacciones').select('id').eq('tarjeta_id',c).eq('estado_revision','confirmado'));
   for(const receipt of receipts)if(receipt.id!==old.id)await sql(`select abaco_privado.reflejar_gasto_ensayo('${book}','${receipt.id}')`);
   assert.equal((await sql(`select abaco_privado.comprobar_ensayo('${book}') as valido`))[0].valido,true);
   const unknown=reuse?reuse.cards[2]:await cuenta(a,null,'USD'),zero=reuse?reuse.cards[3]:await cuenta(a,0,'USD');const u=await apertura(a,unknown),z=await apertura(a,zero);
   assert.equal(ok(await a.client.from('libro_saldos_ensayo').select('saldo_reconstruido').eq('apertura_id',u).single()).saldo_reconstruido,null);
   assert.equal(ok(await a.client.from('libro_saldos_ensayo').select('saldo_reconstruido').eq('apertura_id',z).single()).saldo_reconstruido,0);
  });
  await t.test('ocho reintentos REST, espejo privado, FK real y motor unico',async()=>{
   const p=payload(c),rows=await Promise.all(Array.from({length:8},()=>gasto(a,p)));assert.equal(new Set(rows.map(x=>x.id)).size,1);assert.equal(await balance(a,c),startBalance-100);
   assert.equal((await sql(`select abaco_privado.comprobar_ensayo('${book}') as valido`))[0].valido,false);
   await sql(`select abaco_privado.reflejar_gasto_ensayo('${book}','${rows[0].id}')`);
   assert.equal((await sql(`select abaco_privado.comprobar_ensayo('${book}') as valido`))[0].valido,true);assert.equal(await balance(a,c),startBalance-100);
   await sql(`do $$begin begin perform abaco_privado.reflejar_gasto_ensayo('${book}','${old.id}');raise exception 'Historico aceptado';exception when unique_violation then null;end;begin insert into public.libro_operaciones(usuario_id,apertura_id,tarjeta_id,tipo,transaccion_id) values('${a.id}','${aperturaB}','${cb}','gasto','${old.id}');raise exception 'FK aceptada';exception when foreign_key_violation then null;end;begin update public.libro_aperturas set saldo_inicial=1 where id='${book}';raise exception 'Cambio aceptado';exception when insufficient_privilege then null;end;end $$;`);
  });
  await t.test('RLS y privilegios reales: aislamiento, DML y funciones privadas',async()=>{
   for(const table of ['libro_aperturas','libro_operaciones','libro_apuntes','libro_historicos_incluidos']){
    assert.equal(ok(await b.client.from(table).select('usuario_id').eq('usuario_id',a.id)).length,0);
    assert.equal((await a.client.from(table).insert({usuario_id:a.id})).error?.code,'42501');
    assert.equal((await admin.from(table).select('*')).error?.code,'42501');
   }
   assert.equal(ok(await b.client.from('libro_saldos_ensayo').select('*').eq('apertura_id',book)).length,0);
   const [r]=await sql("select count(*)::int as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join (values ('anon'),('authenticated'),('service_role')) r(rol) where n.nspname='abaco_privado' and p.proname in ('preparar_apertura_ensayo','reflejar_gasto_ensayo','comprobar_ensayo','libro_inmutable') and has_function_privilege(r.rol,p.oid,'execute')");assert.equal(r.count,0);
   assert.ok((await a.client.schema('abaco_privado').rpc('comprobar_ensayo',{p_apertura:book})).error);
  });
  await t.test('compatibilidad Edge v1/v2 con credenciales sinteticas dedicadas y revocacion',async()=>{
   const send=async(body,token)=>{const res=await solicitar('/functions/v1/registrar-gasto-atajo',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json()};};
   for(const version of [1,2]){
    const token='abaco_'+randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex');let binding;
    if(version===2){
     if(reuse){const rows=ok(await a.client.from('vinculos_captura').select('id').eq('tarjeta_id',c).is('revocado_at',null));assert.equal(rows.length,1);binding=rows[0].id;}
     else{const instrument=ok(await a.client.rpc('crear_instrumento_pago',{p_alias:prefix,p_tipo:'wallet'}));binding=ok(await a.client.rpc('crear_vinculo_captura',{p_instrumento:instrument,p_tarjeta:c}));}
    }
    const id=ok(await a.client.rpc(version===1?'crear_integracion_atajo':'crear_credencial_vinculo',version===1?{p_tarjeta:c,p_hash:hash}:{p_vinculo:binding,p_hash:hash}));credentials.push(id);await save();
    const p=payload(c,{origen:'atajo_manual',monto:10});delete p.tarjetaId;if(version===2)Object.assign(p,{version:2,binding_id:binding});
    const first=await send(p,token),repeat=await send(p,token);assert.equal(first.status,201);assert.equal(repeat.body.data.id,first.body.data.id);
    ok(await a.client.rpc('revocar_integracion_atajo',{p_id:id}));assert.equal((await send(p,token)).status,401);
   }
   assert.equal(await balance(a,c),startBalance-120);
  });
  await t.test('usuarios y administradores: MFA TOTP real bloquea AAL1 y habilita AAL2',async()=>{
   for(const x of [a,b]){
    if(x===b)ok(await admin.from('usuarios').update({rol:'admin'}).eq('id',b.id));
    if(x===b)assert.equal(ok(await b.client.from('libro_aperturas').select('id')).length,0);
    const factor=ok(await x.client.auth.mfa.enroll({factorType:'totp',friendlyName:prefix,issuer:'Abaco staging'}));
    ok(await x.client.auth.mfa.challengeAndVerify({factorId:factor.id,code:codigo(factor.totp.secret)}));
    const low=nuevo();ok(await low.auth.signInWithPassword({email:x.email,password:x.password}));
    assert.equal(ok(await low.from('libro_saldos_ensayo').select('apertura_id')).length,0);
    assert.ok(ok(await x.client.from('libro_saldos_ensayo').select('apertura_id')).length>0);
   }
  });
 }finally{
  // Immutable rehearsal history is retained; never disable triggers or touch existing accounts to clean up.
  await save();if(credentials.length){const ids=credentials.map(id=>"'"+id+"'::uuid").join(',');const owners=actors.map(x=>"'"+x.id+"'::uuid").join(',');await sql(`update public.integraciones_atajos set revocado_at=coalesce(revocado_at,now()) where id=any(array[${ids}]) and usuario_id=any(array[${owners}])`);}for(const x of actors){ok(await admin.from('usuarios').update({rol:'usuario'}).eq('id',x.id));ok(await admin.auth.admin.updateUserById(x.id,{ban_duration:'876000h'}));}if(actors.length){const owners=actors.map(x=>"'"+x.id+"'::uuid").join(',');await sql(`delete from auth.sessions where user_id=any(array[${owners}])`);}
  for(const x of actors){const user=ok(await admin.auth.admin.getUserById(x.id)).user;assert.ok(Date.parse(user.banned_until)>Date.now());assert.equal(ok(await admin.from('usuarios').select('rol').eq('id',x.id).single()).rol,'usuario');}
  if(actors.length){const ids=actors.map(x=>"'"+x.id+"'::uuid").join(',');const [r]=await sql(`select (select count(*)::int from auth.sessions where user_id=any(array[${ids}])) as sessions,(select count(*)::int from integraciones_atajos where usuario_id=any(array[${ids}]) and revocado_at is null) as active_credentials`);assert.equal(r.sessions,0);assert.equal(r.active_credentials,0);}

 }
});
