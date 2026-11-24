import AuthShell from '@/components/auth/AuthShell';
import AccesoForm from '@/components/auth/AccesoForm';
import { destinoSeguro } from '@/lib/auth/rutas.mjs';

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const mensaje = params.error ? 'No se pudo completar el acceso. El enlace puede haber vencido; solicita uno nuevo.'
    : params.mensaje === 'confirma' ? 'Confirma tu correo antes de acceder.' : '';
  return <AuthShell titulo="Bienvenido a Ábaco" descripcion="Entra para ver tus cuentas, registrar gastos y entender tu mes.">
    <AccesoForm siguiente={destinoSeguro(params.next)} mensajeInicial={mensaje} />
  </AuthShell>;
}
