import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completarCallback } from '../src/lib/auth/callbacks.mjs';

const permitido = { autenticado:true,correo_confirmado:true,permitido:true,requiere_mfa:false };
function cliente(estado=permitido,error=null) {
  const llamadas=[];
  return { llamadas,auth:{ exchangeCodeForSession:async code=>{llamadas.push(['pkce',code]);return {error};},verifyOtp:async value=>{llamadas.push(['email',value]);return {error};} },rpc:async name=>{llamadas.push(['rpc',name]);return {data:estado,error:null};} };
}
test('callbacks PKCE y confirmación: intercambian credencial y solo redirigen a destinos permitidos',async()=>{
  const api=cliente();
  assert.equal(await completarCallback(api,new URLSearchParams({code:'codigo',next:'//externo.invalid'})),'/');
  assert.deepEqual(api.llamadas,[['pkce','codigo'],['rpc','estado_seguridad']]);
  assert.equal(await completarCallback(cliente(),new URLSearchParams({token_hash:'hash',type:'email',next:'/configuracion'}),'email'),'/configuracion');
});
test('callbacks inválidos, vencidos o sin configuración fallan sin bucles ni páginas privadas',async()=>{
  const api=cliente();
  for(const params of [{},{code:'x'.repeat(2049)}])assert.equal(await completarCallback(api,new URLSearchParams(params)),'/login?error=auth');
  assert.equal(api.llamadas.length,0);
  assert.equal(await completarCallback(cliente(permitido,{}),new URLSearchParams({code:'vencido'})),'/login?error=auth');
  assert.equal(await completarCallback(api,new URLSearchParams({token_hash:'hash',type:'invite'}),'email'),'/login?error=auth');
  assert.equal(await completarCallback({auth:api.auth,rpc:async()=>({error:{}})},new URLSearchParams({code:'correcto'})),'/login?error=seguridad');
});
test('recuperación conserva MFA para usuarios y administradores, antes de cambiar contraseña',async()=>{
  const bloqueado={...permitido,requiere_mfa:true,permitido:false};
  const params=new URLSearchParams({token_hash:'hash-recuperacion',type:'recovery',next:'https://externo.invalid'});
  for(const administrador of [false,true]){
    const api=cliente({...bloqueado,administrador});
    assert.equal(await completarCallback(api,params,'email'),'/auth/mfa?next=%2Fauth%2Factualizar-clave');
    assert.deepEqual(api.llamadas,[['email',{token_hash:'hash-recuperacion',type:'recovery'}],['rpc','estado_seguridad']]);
  }
  assert.equal(await completarCallback(cliente(),params,'email'),'/auth/actualizar-clave');
});
