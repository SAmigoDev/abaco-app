import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGING_URL, validarUrlStaging, validarWorkspaceStaging } from './integration/staging-target.mjs';

test('las herramientas de integración rechazan destinos ajenos al staging confirmado', async () => {
  assert.equal(validarUrlStaging(STAGING_URL), STAGING_URL);
  for (const value of ['http://localhost:3000', 'https://otro.supabase.co', STAGING_URL+'.otro.invalid', STAGING_URL+'/?token=oculto', STAGING_URL+'/rest/v1']) {
    assert.throws(() => validarUrlStaging(value));
  }
  await assert.rejects(validarWorkspaceStaging('C:/Users/ejemplo/OneDrive/abaco-app'), /workspace aislado/);
});
