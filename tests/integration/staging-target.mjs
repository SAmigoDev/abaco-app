import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const STAGING_REF = 'bikubreyffppuxfxzxew';
export const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

export async function validarWorkspaceStaging(workdir) {
  if (!workdir || path.resolve(workdir).toLowerCase().includes('onedrive')) throw new Error('Se requiere el workspace aislado, fuera del checkout conectado');
  const marker = JSON.parse(await readFile(path.join(workdir, 'AUTHORIZED_STAGING.json'), 'utf8'));
  const linked = (await readFile(path.join(workdir, 'supabase/.temp/project-ref'), 'utf8')).trim();
  if (marker.project_ref !== STAGING_REF || linked !== STAGING_REF || marker.empty_confirmed_by_user !== true || marker.production_access !== false) {
    throw new Error('Destino de staging no autorizado');
  }
  return { projectRef: STAGING_REF, url: STAGING_URL };
}

export function validarUrlStaging(value) {
  const url = new URL(value);
  if (url.origin !== STAGING_URL || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Se rechaza cualquier URL distinta del staging autorizado');
  }
  return STAGING_URL;
}

export function validarOrigenWebStaging(value, state) {
  if (value === 'http://localhost:3100') return value;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || !url.hostname.endsWith('.vercel.app') || url.username || url.password) {
    throw new Error('Se requiere el origen HTTPS exacto del staging autorizado');
  }
  if (!state || state.projectName !== 'abaco-staging' || !(state.createdByThisRun === true || (state.provisionedBy === 'user' && state.verifiedEmptyProject === true)) || !state.projectId ||
      state.supabaseProjectRef !== STAGING_REF || state.productionAccess !== false || state.origin !== value) {
    throw new Error('El origen no pertenece al proyecto nuevo de staging registrado');
  }
  return value;
}
