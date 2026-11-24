import { exigirSesion } from '@/lib/auth/server';
import AuthShell from '@/components/auth/AuthShell';
import ActualizarClaveForm from '@/components/auth/ActualizarClaveForm';

export default async function ActualizarClavePage() {
  await exigirSesion('/auth/actualizar-clave');
  return <AuthShell titulo="Actualiza tu contraseña" descripcion="Elige una contraseña única. Tu segundo factor se conserva después de cambiarla."><ActualizarClaveForm /></AuthShell>;
}
