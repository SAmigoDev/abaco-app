import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validarOrigenWebStaging,STAGING_REF} from './integration/staging-target.mjs';

test('la prueba web solo entrega tokens al origen local o HTTPS del nuevo proyecto registrado',()=>{
 const origin='https://abaco-staging-ejemplo.vercel.app';
 const state={projectName:'abaco-staging',projectId:'prj_ficticio',createdByThisRun:true,supabaseProjectRef:STAGING_REF,productionAccess:false,origin};
 assert.equal(validarOrigenWebStaging('http://localhost:3100'), 'http://localhost:3100');
 assert.equal(validarOrigenWebStaging(origin,state),origin);
 const userState={...state,createdByThisRun:false,provisionedBy:'user',verifiedEmptyProject:true};
 assert.equal(validarOrigenWebStaging(origin,userState),origin);
 assert.throws(()=>validarOrigenWebStaging(origin,{...userState,verifiedEmptyProject:false}));
 for(const value of ['http://abaco-staging-ejemplo.vercel.app',origin+'/',origin+'/auth/confirm','https://otro.vercel.app','https://example.invalid','https://usuario@abaco-staging-ejemplo.vercel.app'])assert.throws(()=>validarOrigenWebStaging(value,state));
 for(const altered of [{},{...state,projectName:'abaco-app'},{...state,productionAccess:true},{...state,createdByThisRun:false},{...state,supabaseProjectRef:'otro'}])assert.throws(()=>validarOrigenWebStaging(origin,altered));
});
