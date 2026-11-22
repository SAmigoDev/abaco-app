import{test}from'node:test';import assert from'node:assert/strict';import{randomUUID,randomBytes}from'node:crypto';import{contextoAlojado}from'./hosted-client.mjs';
const enabled=process.env.ABACO_HOSTED_TEST_ACK==='bikubreyffppuxfxzxew:synthetic-only';
const ok=r=>{assert.ok(!r.error,'Operacion sintetica rechazada');return r.data;};
test('007 alojado: alta propia, edicion concurrente con gasto y saldo protegido por API',{skip:!enabled},async()=>{
 const {admin,nuevo,sql}=await contextoAlojado();assert.equal((await sql("select version from supabase_migrations.schema_migrations where version='202611220007'")).length,1);
 let id;try{
  const email=`abaco-edicion-${randomUUID()}@abaco-test.invalid`,password=randomBytes(24).toString('hex')+'aA1!';id=ok(await admin.auth.admin.createUser({email,password,email_confirm:true})).user.id;
  const c=nuevo();ok(await c.auth.signInWithPassword({email,password}));
  const card=ok(await c.from('tarjetas').insert({usuario_id:id,alias:'Original',ultimos_digitos:'0099',tipo_producto:'cuenta_corriente',moneda:'CLP',saldo_actual:10000}).select('id,saldo_actual').single());assert.equal(card.saldo_actual,10000);
  const payload={evento_id:randomUUID(),tarjetaId:card.id,monto:100,moneda:'CLP',comercio:'Ficticio',fecha:new Date().toISOString(),origen:'manual'};
  await Promise.all([c.from('tarjetas').update({alias:'Alias concurrente'}).eq('id',card.id).then(ok),c.rpc('registrar_gasto',{p_usuario:id,p_datos:payload,p_token_hash:null}).then(ok)]);
  let row=ok(await c.from('tarjetas').select('alias,saldo_actual').eq('id',card.id).single());assert.equal(row.alias,'Alias concurrente');assert.equal(row.saldo_actual,9900);
  for(const client of [c,admin])assert.ok((await client.from('tarjetas').update({alias:'Antiguo',saldo_actual:10000}).eq('id',card.id)).error);
  row=ok(await c.from('tarjetas').select('alias,saldo_actual').eq('id',card.id).single());assert.equal(row.saldo_actual,9900);assert.equal(row.alias,'Alias concurrente');
  ok(await c.rpc('registrar_gasto',{p_usuario:id,p_datos:payload,p_token_hash:null}));assert.equal(ok(await c.from('tarjetas').select('saldo_actual').eq('id',card.id).single()).saldo_actual,9900);
 }finally{if(id)ok(await admin.auth.admin.deleteUser(id));}
});
