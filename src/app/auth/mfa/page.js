import { redirect } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import MfaPanel from '@/components/auth/MfaPanel';
import { sesionVerificada } from '@/lib/auth/server';
import { destinoSeguro } from '@/lib/auth/rutas.mjs';

export default async function MfaPage({ searchParams }) {
  const { estado } = await sesionVerificada();
  if (!estado?.autenticado) redirect('/login');
  if (!estado.correo_confirmado) redirect('/login?mensaje=confirma');
  const params = await searchParams;
  return <AuthShell titulo="Verifica tu identidad" descripcion="Usa un código temporal de tu aplicación autenticadora."><MfaPanel estadoInicial={estado} siguiente={destinoSeguro(params.next)} /></AuthShell>;
}
