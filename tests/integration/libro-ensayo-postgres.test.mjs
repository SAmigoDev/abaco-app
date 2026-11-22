import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Opt-in. Does not read .env.local, CLI link, PGHOST, remote URLs or any real account.
const habilitado=process.env.ABACO_SQL_TEST_ACK==='synthetic-only';
test('008 libro inactivo: apertura, historia y concurrencia local', {skip:!habilitado},async t=>{
 const bin=process.env.ABACO_TEST_PG_BIN;
 const dataDir=process.env.ABACO_TEST_PG_DATA;
 const port=process.env.ABACO_TEST_PG_PORT;
 assert.ok(bin && dataDir && /^5[0-9]{4}$/.test(port||''),'Debe declarar binarios, PGDATA aislado y puerto de pruebas');
 const nombre='abaco_it_'+randomUUID().replaceAll('-','');
 const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
 function sql(text,db='postgres') {
  return new Promise((resolve,reject)=>{
   const entorno=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PG/i.test(key)));
   const proc=spawn(path.join(bin,'psql.exe'),['-X','-qAt','-h','127.0.0.1','-p',port,'-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],{
    windowsHide:true,env:{...entorno,PGCLIENTENCODING:'UTF8',PGCONNECT_TIMEOUT:'5',PGPASSFILE:path.join(dataDir,'abaco-no-passwords')},stdio:['pipe','pipe','pipe']
   });
   let out='',err='';proc.stdout.on('data',b=>out+=b);proc.stderr.on('data',b=>err+=b);
   proc.on('error',reject);proc.on('close',code=>code===0?resolve(out.trim()):reject(new Error(err.trim()||'psql falló')));
   proc.stdin.end(text);
  });
 }
 const actual=(await sql('show data_directory;')).replaceAll('\\','/');
 assert.equal(path.normalize(await realpath(actual)).toLowerCase(),path.normalize(await realpath(dataDir)).toLowerCase(),'Rechaza cualquier clúster distinto del aislado');
 assert.match(actual.replaceAll('\\','/'),/\/work\/staging-pg\/data$/i,'PGDATA debe ser el clúster creado para estas pruebas');
 await sql('create database '+nombre+';');
 const ejecutar=text=>sql(text,nombre);
 const uno=async text=>JSON.parse(await ejecutar(text));
 const uid='10000000-0000-4000-8000-000000000001';
 const otro='10000000-0000-4000-8000-000000000002';
 const admin='10000000-0000-4000-8000-000000000003';
 const tarjeta='20000000-0000-4000-8000-000000000001';
 const ajena='20000000-0000-4000-8000-000000000002';
 const credito='20000000-0000-4000-8000-000000000003';
 const sid='30000000-0000-4000-8000-000000000001';
 const aid='30000000-0000-4000-8000-000000000003';
 const factor='40000000-0000-4000-8000-000000000001';
 function como(text,{user=uid,aal='aal1',role='authenticated',session=sid}={}){
  assert.ok(['authenticated','service_role','anon'].includes(role));
  return ejecutar(`begin;set local role ${role};set local "request.jwt.claims"=${literal(JSON.stringify({sub:user,role,aal,session_id:session}))};${text};commit;`);
 }
 const datos=(extra={})=>({evento_id:randomUUID(),tarjetaId:tarjeta,monto:100,moneda:'CLP',comercio:'Comercio ficticio',fecha:'2026-01-02T12:00:00Z',origen:'manual',...extra});
 const registrar=(payload,opts={})=>como(`select row_to_json(t) from public.registrar_gasto(${literal(opts.user||uid)},${literal(JSON.stringify(payload))}::jsonb,null) t`,opts).then(JSON.parse);
 const token=(payload,hash='a'.repeat(64))=>como(`select row_to_json(t) from public.registrar_gasto(null,${literal(JSON.stringify(payload))}::jsonb,${literal(hash)}) t`,{user:null,role:'service_role'}).then(JSON.parse);
 const saldo=async id=>Number(await ejecutar(`select saldo_actual from public.tarjetas where id=${literal(id||tarjeta)};`));
 try {
  await ejecutar(await readFile(new URL('./local_auth.sql',import.meta.url),'utf8'));
  const base=await readFile(new URL('../../supabase/staging/00_base_public.sql',import.meta.url),'utf8');
  await assert.rejects(ejecutar(base),/Staging/);
  await ejecutar("set abaco.staging_confirmed='empty-synthetic-only';\n"+base);
  await ejecutar(await readFile(new URL('../../supabase/tests/auditoria_previa.sql',import.meta.url),'utf8'));
  for(const file of ['202611130001_usuarios_permisos.sql','202611130002_registro_atajos.sql','202611130003_revision_gastos.sql','202611130004_auth_mfa.sql','202611190005_instrumentos_vinculos.sql','202611190006_alias_captura.sql','202611220007_edicion_cuentas.sql']) await ejecutar(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
  const fingerprint="select md5(string_agg(pg_get_functiondef(p.oid),'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','abaco_privado') and p.proname in ('registrar_gasto','confirmar_gasto_pendiente','actualizar_saldo_tarjeta')";
  const motorAntes=await ejecutar(fingerprint);
  const migracion=await readFile(new URL('../../supabase/migrations/202611220008_libro_ensayo.sql',import.meta.url),'utf8');
  async function esperar(sqlTexto){for(let intento=0;intento<15;intento++){if(Number(await ejecutar(sqlTexto))>0)return;await new Promise(r=>setTimeout(r,20));}throw Error('No se observo el bloqueo esperado');}
  await t.test('DDL aborta por lock_timeout sin dejar esquema parcial',async()=>{
   const holder=ejecutar("begin;set local application_name='abaco_008_ddl';lock table transacciones in row exclusive mode;select pg_sleep(4);rollback;");
   try{
    await esperar("select count(*) from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.application_name='abaco_008_ddl' and l.relation='transacciones'::regclass and l.granted");
    await assert.rejects(ejecutar(migracion),/lock timeout|bloqueo/i);
    assert.equal(await ejecutar("select to_regclass('public.libro_aperturas') is null"),'t');
    assert.equal(await ejecutar("select count(*) from pg_constraint where conname='libro_transaccion_propietario'"),'0');
   }finally{await holder;}
  });
  await t.test('instalacion observa locks DDL sobre las relaciones vigentes',async()=>{
   const installing=ejecutar("set application_name='abaco_008_install';"+migracion.replace(/commit;\s*$/,()=>"select pg_sleep(2);commit;"));
   try{
    await esperar("select count(*) from pg_stat_activity where datname=current_database() and application_name='abaco_008_install' and wait_event='PgSleep'");
    const locks=JSON.parse(await ejecutar("select json_agg(json_build_object('tabla',l.relation::regclass::text,'modo',l.mode)) from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.datname=current_database() and a.application_name='abaco_008_install' and l.granted and l.relation in ('public.transacciones'::regclass,'public.tarjetas'::regclass,'public.usuarios'::regclass)"));
    assert.ok(locks.some(l=>l.tabla==='transacciones'&&l.modo==='AccessExclusiveLock'));
    assert.ok(locks.some(l=>l.tabla==='tarjetas'&&l.modo==='ShareRowExclusiveLock'));
    console.log('Locks DDL locales: '+JSON.stringify(locks));
   }finally{await installing;}
  });
  await ejecutar(await readFile(new URL('../../supabase/tests/auditoria_auth_mfa.sql',import.meta.url),'utf8'));
  await ejecutar(await readFile(new URL('../../supabase/tests/auditoria_multitarjeta.sql',import.meta.url),'utf8'));
  await ejecutar(`set role supabase_auth_admin;insert into auth.users(id,email,email_confirmed_at) values
   ('${uid}','uno@abaco-test.invalid',now()),('${otro}','dos@abaco-test.invalid',now()),('${admin}','admin@abaco-test.invalid',now());
   insert into auth.sessions(id,user_id) values('${sid}','${uid}'),('${aid}','${admin}');reset role;
   update public.usuarios set rol='admin' where id='${admin}';
   insert into public.tarjetas(id,usuario_id,alias,ultimos_digitos,tipo_producto,moneda,saldo_actual,cupo_maximo) values
   ('${tarjeta}','${uid}','Cuenta ficticia','0001','cuenta_corriente','CLP',10000,null),
   ('${ajena}','${otro}','Cuenta ajena ficticia','0002','cuenta_corriente','CLP',10000,null),
   ('${credito}','${uid}','Crédito ficticio','0003','credito_nacional','CLP',0,100000);
   insert into public.tasas_cambio(moneda,valor) values('USD',950);`);
  const preparar=(cuenta=tarjeta,clave=randomUUID(),user=uid)=>ejecutar(`select abaco_privado.preparar_apertura_ensayo('${user}','${cuenta}','${clave}','ensayo-sin-activacion')`);
  const reconstruido=async id=>JSON.parse(await ejecutar(`select to_json(saldo_reconstruido) from libro_saldos_ensayo where apertura_id='${id}'`));
  const vigente=async id=>(await ejecutar(`select abaco_privado.comprobar_ensayo('${id}')`))==='t';
  const reflejar=(a,g)=>ejecutar(`select abaco_privado.reflejar_gasto_ensayo('${a}','${g}')`);
  let apertura,historico,nuevo;
  await t.test('expansion no altera motor, saldos ni crea aperturas automaticas',async()=>{
   assert.equal(await ejecutar(fingerprint),motorAntes);
   assert.equal(await saldo(),10000);assert.equal(await ejecutar('select count(*) from libro_aperturas'),'0');
  });
  await t.test('apertura copia saldo neto, incluye historia y reintentar no descuenta otra vez',async()=>{
   const p=datos({monto:1000});historico=await registrar(p);assert.equal(await saldo(),9000);
   const key=randomUUID();apertura=await preparar(tarjeta,key);
   assert.equal(await preparar(tarjeta,key),apertura);assert.equal(await reconstruido(apertura),9000);assert.equal(await saldo(),9000);
   assert.equal(await ejecutar(`select count(*) from libro_historicos_incluidos where apertura_id='${apertura}'`),'1');
   assert.equal(await ejecutar(`select count(*) from libro_apuntes where apertura_id='${apertura}'`),'1');
   await assert.rejects(reflejar(apertura,historico.id),/Historico incluido/);
   assert.equal((await registrar(p)).id,historico.id);assert.equal(await saldo(),9000);assert.equal(await vigente(apertura),true);
   await assert.rejects(preparar(credito,key),/otra cuenta/);await assert.rejects(preparar(ajena,randomUUID(),uid),/no autorizada/);
  });
  await t.test('gasto posterior sigue en motor actual; espejo explicito es idempotente y no escribe saldo',async()=>{
   nuevo=await registrar(datos({monto:100}));assert.equal(await saldo(),8900);assert.equal(await reconstruido(apertura),9000);assert.equal(await vigente(apertura),false);
   const op=await reflejar(apertura,nuevo.id);assert.equal(await reflejar(apertura,nuevo.id),op);
   assert.equal(await reconstruido(apertura),8900);assert.equal(await saldo(),8900);assert.equal(await vigente(apertura),true);
   const pendiente=await registrar(datos({monto:20000}));assert.equal(pendiente.estado_revision,'pendiente');
   await assert.rejects(reflejar(apertura,pendiente.id),/no autorizado/);assert.equal(await saldo(),8900);
   await como(`select confirmar_gasto_pendiente('${pendiente.id}',100)`);await reflejar(apertura,pendiente.id);
   assert.equal(await reconstruido(apertura),8800);assert.equal(await saldo(),8800);assert.equal(await vigente(apertura),true);
  });
  await t.test('comprobador detecta importes compensados incorrectamente y faltas de estructura',async()=>{
   // Two mirrored amounts change in opposite directions: account total remains identical.
   assert.equal(await ejecutar("begin;update transacciones set monto_cuenta=monto_cuenta+case when id='"+nuevo.id+"' then 1 else -1 end where id in(select transaccion_id from libro_operaciones where apertura_id='"+apertura+"' and tipo='gasto');select abaco_privado.comprobar_ensayo('"+apertura+"');rollback;"),'f');
   const vacia=randomUUID();
   assert.equal(await ejecutar("begin;insert into libro_aperturas(id,usuario_id,tarjeta_id,moneda,tipo_producto,saldo_inicial,solicitud_id) values('"+vacia+"','"+uid+"','"+tarjeta+"','CLP','cuenta_corriente',8800,gen_random_uuid());select abaco_privado.comprobar_ensayo('"+vacia+"');rollback;"),'f');
  });
  await t.test('credito y cuotas conservan deuda total una vez; desconocido no se vuelve cero',async()=>{
   await registrar(datos({tarjetaId:credito,monto:300,numCuotas:3,tasaCuotas:0}));const c=await preparar(credito);
   assert.equal(await reconstruido(c),300);assert.equal(await saldo(credito),300);assert.equal(await ejecutar('select count(*) from compras_cuotas'),'1');
   const desconocida=randomUUID(),cero=randomUUID(),negativa=randomUUID();
   for(const [id,monto] of [[desconocida,'null'],[cero,'0'],[negativa,'-500']])await ejecutar(`insert into tarjetas(id,usuario_id,alias,ultimos_digitos,tipo_producto,moneda,saldo_actual) values('${id}','${uid}','Sintetica','0000','cuenta_corriente','USD',${monto})`);
   const d=await preparar(desconocida);assert.equal(await ejecutar(`select saldo_reconstruido is null from libro_saldos_ensayo where apertura_id='${d}'`),'t');
   assert.equal(await ejecutar(`select count(*) from libro_apuntes where apertura_id='${d}'`),'0');
   const grande=randomUUID();await ejecutar("insert into tarjetas(id,usuario_id,alias,ultimos_digitos,tipo_producto,moneda,saldo_actual) values('"+grande+"','"+uid+"','Precision legacy','0000','cuenta_corriente','CLP',1000000000000000001)");
   const g=await preparar(grande);assert.equal(await ejecutar("select saldo_reconstruido::text from libro_saldos_ensayo where apertura_id='"+g+"'"),'1000000000000000001');
   assert.equal(await reconstruido(await preparar(cero)),0);assert.equal(await reconstruido(await preparar(negativa)),-500);
  });
  await t.test('v1 y v2 siguen registrando una vez y revocar corta reintentos, sin hooks al libro',async()=>{
   const prev=await saldo(),apuntes=await ejecutar('select count(*) from libro_apuntes');
   const id=await como("select crear_integracion_atajo('"+tarjeta+"','"+'a'.repeat(64)+"')");
   const p=datos({origen:'atajo_manual',monto:10});const x=await token(p);assert.equal((await token(p)).id,x.id);
   const instrumento=await como("select crear_instrumento_pago('Ensayo v2','wallet')");
   const binding=await como("select crear_vinculo_captura('"+instrumento+"','"+tarjeta+"')");
   await como("select crear_credencial_vinculo('"+binding+"','"+'b'.repeat(64)+"')");
   const v2=datos({origen:'apple_wallet',version:2,binding_id:binding,monto:10});delete v2.tarjetaId;
   const y=await token(v2,'b'.repeat(64));assert.equal((await token(v2,'b'.repeat(64))).id,y.id);
   assert.equal(await saldo(),prev-20);assert.equal(await ejecutar('select count(*) from libro_apuntes'),apuntes);
   await como("select revocar_integracion_atajo('"+id+"')");await assert.rejects(token(p),/Credencial/);
  });
  await t.test('locks de ensayo bloquean gasto del mismo usuario pero no al de otro usuario',async()=>{
   const otra=randomUUID();await ejecutar("insert into auth.sessions(id,user_id) values('"+otra+"','"+otro+"')");
   const prev=await saldo(),prevOtra=await saldo(ajena);
   const holder=ejecutar("begin;set local application_name='abaco_008_holder';select abaco_privado.preparar_apertura_ensayo('"+uid+"','"+tarjeta+"',gen_random_uuid(),'ensayo-sin-activacion');select pg_sleep(30);commit;").then(()=>null,e=>e);
   let writer;
   try{
    await esperar("select count(*) from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.datname=current_database() and a.application_name='abaco_008_holder' and l.locktype='advisory' and l.granted");
    writer=como("set local application_name='abaco_008_writer'; select (registrar_gasto('"+uid+"',"+literal(JSON.stringify(datos({monto:1})))+"::jsonb,null)).id");
    await esperar("select count(*) from pg_stat_activity where datname=current_database() and application_name='abaco_008_writer' and cardinality(pg_blocking_pids(pid))>0");
    await registrar(datos({tarjetaId:ajena,monto:1}),{user:otro,session:otra});
    assert.equal(await saldo(ajena),prevOtra-1);assert.equal(await saldo(),prev);
   }finally{
    await ejecutar("select pg_cancel_backend(pid) from pg_stat_activity where datname=current_database() and application_name='abaco_008_holder'");
    await holder;if(writer)await writer;
   }
   assert.equal(await saldo(),prev-1);
  });
  await t.test('FK, inmutabilidad y ACL bloquean escritura publica, cruce de propietarios y AAL1 con MFA',async()=>{
   await assert.rejects(ejecutar(`update libro_aperturas set saldo_inicial=1 where id='${apertura}'`),/inmutable/);
   await assert.rejects(ejecutar(`delete from libro_apuntes where apertura_id='${apertura}'`),/inmutable/);
   await assert.rejects(ejecutar(`insert into libro_operaciones(usuario_id,apertura_id,tarjeta_id,tipo,transaccion_id) values('${otro}','${apertura}','${tarjeta}','gasto','${historico.id}')`),/foreign key|foránea/i);
   const probe=randomUUID();await ejecutar("insert into tarjetas(id,usuario_id,alias,ultimos_digitos,tipo_producto,moneda,saldo_actual) values('"+probe+"','"+uid+"','FK probe','0000','cuenta_corriente','CLP',0)");await preparar(probe);
   await como("update tarjetas set alias='Alias permitido' where id='"+probe+"'");
   await assert.rejects(ejecutar("update tarjetas set moneda='USD' where id='"+probe+"'"),/foreign key|foránea/i);
   await assert.rejects(ejecutar("delete from tarjetas where id='"+probe+"'"),/foreign key|foránea/i);
   assert.equal(await ejecutar("select alias from tarjetas where id='"+probe+"'"),'Alias permitido');
   const txCredito=await ejecutar("select id from transacciones where tarjeta_id='"+credito+"' limit 1");
   await assert.rejects(ejecutar("insert into libro_historicos_incluidos(usuario_id,apertura_id,transaccion_id,tarjeta_id) values('"+uid+"','"+apertura+"','"+txCredito+"','"+tarjeta+"')"),/foreign key|foránea/i);
   for(const tabla of ['libro_aperturas','libro_operaciones','libro_apuntes','libro_historicos_incluidos']){
    for(const role of ['anon','authenticated','service_role']){
     assert.equal(await ejecutar("select has_table_privilege('"+role+"','public."+tabla+"','insert,update,delete,truncate')"),'f');
    }
   }
   for(const role of ['anon','service_role'])await assert.rejects(como('select * from libro_saldos_ensayo',{role}),/permission denied|permiso denegado/i);
   assert.equal(await ejecutar("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join (values ('anon'),('authenticated'),('service_role')) r(rol) where n.nspname='abaco_privado' and p.proname in ('libro_inmutable','preparar_apertura_ensayo','reflejar_gasto_ensayo','comprobar_ensayo') and has_function_privilege(r.rol,p.oid,'execute')"),'0');
   const otraSesion=randomUUID();await ejecutar(`insert into auth.sessions(id,user_id) values('${otraSesion}','${otro}')`);
   assert.equal(await como('select count(*) from libro_saldos_ensayo',{user:otro,session:otraSesion}),'0');
   for(const role of ['anon','authenticated','service_role']){
    await assert.rejects(como(`select abaco_privado.preparar_apertura_ensayo('${uid}','${tarjeta}','${randomUUID()}','ensayo-sin-activacion')`,{role}),/permission denied|permiso denegado/i);
    await assert.rejects(como(`insert into libro_aperturas(usuario_id) values('${uid}')`,{role}),/permission denied|permiso denegado/i);
   }
   await ejecutar(`set role supabase_auth_admin;insert into auth.mfa_factors values('${factor}','${uid}','verified','totp');update auth.sessions set aal='aal2',factor_id='${factor}' where id='${sid}';reset role;`);
   assert.equal(await como('select count(*) from libro_saldos_ensayo'),'0');
   assert.ok(Number(await como('select count(*) from libro_saldos_ensayo',{aal:'aal2'}))>0);
  });
  await t.test('procedimiento de ensayo exige confirmacion y revierte todas sus aperturas',async()=>{
   const script=await readFile(new URL('../../supabase/tests/ensayo_transicion_libro_local.sql',import.meta.url),'utf8');
   const count=await ejecutar('select count(*) from libro_aperturas');
   await assert.rejects(ejecutar(script),/confirmacion/);
   await ejecutar("set abaco.libro_ensayo_local='base-local-sintetica';"+script);
   assert.equal(await ejecutar('select count(*) from libro_aperturas'),count);
  });
  await t.test('rollback atomico y ocho solicitudes independientes con gasto concurrente',async()=>{
   const count=await ejecutar('select count(*) from libro_aperturas');
   await assert.rejects(ejecutar(`begin;select abaco_privado.preparar_apertura_ensayo('${uid}','${tarjeta}','${randomUUID()}','ensayo-sin-activacion');select 1/0;commit;`),/zero|cero/i);
   assert.equal(await ejecutar('select count(*) from libro_aperturas'),count);
   const key=randomUUID(),antes=await saldo();
   const resultados=await Promise.all([...Array.from({length:8},()=>preparar(tarjeta,key)),registrar(datos({monto:100}),{aal:'aal2'})]);
   const ids=resultados.slice(0,8);assert.equal(new Set(ids).size,1);const a=ids[0],g=resultados[8];
   const incluido=await ejecutar(`select count(*) from libro_historicos_incluidos where apertura_id='${a}' and transaccion_id='${g.id}'`);
   assert.equal(await reconstruido(a),antes-(incluido==='1'?100:0));assert.equal(await saldo(),antes-100);
   if(incluido==='0')await reflejar(a,g.id);else await assert.rejects(reflejar(a,g.id),/Historico incluido/);
   assert.equal(await reconstruido(a),antes-100);assert.equal(await vigente(a),true);
  });
 } finally {
  // Only the unique database created by this run, on the verified disposable cluster.
  await sql('drop database '+nombre+' with (force);');
 }
});
