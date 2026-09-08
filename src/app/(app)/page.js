import { createClient } from '@/lib/supabase/server';
import OnboardingWizard from '@/components/OnboardingWizard';
import DashboardView from '@/components/DashboardView';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tasasCambio } = await supabase.from('tasas_cambio').select('moneda, valor');

  const { data: tarjetas, error: errorTarjetas } = await supabase
    .from('tarjetas')
    .select('*')
    .eq('usuario_id', user.id)
    .order('created_at', { ascending: true });

  if (errorTarjetas) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-navy-900 px-4">
        <p className="text-danger text-sm">No se pudieron cargar tus tarjetas: {errorTarjetas.message}</p>
      </main>
    );
  }

  if (!tarjetas || tarjetas.length === 0) {
    return <OnboardingWizard />;
  }

  const inicioAnio = `${new Date().getFullYear()}-01-01T00:00:00Z`;

  const { data: transacciones, error: errorTransacciones } = await supabase
    .from('transacciones')
    .select('id, monto_clp, comercio, fecha, categoria_id, categorias(nombre, icono)')
    .eq('usuario_id', user.id)
    .gte('fecha', inicioAnio)
    .order('fecha', { ascending: true });

  const { data: metas } = await supabase
    .from('metas_ahorro')
    .select('*')
    .eq('usuario_id', user.id);

  const { data: movimientosFijos } = await supabase
    .from('movimientos_fijos')
    .select('*, categorias(nombre, icono), tarjetas(alias)')
    .eq('usuario_id', user.id);

  return (
    <DashboardView
      tarjetas={tarjetas}
      transacciones={transacciones || []}
      errorTransacciones={errorTransacciones?.message ?? null}
      metas={metas || []}
      movimientosFijos={movimientosFijos || []}
      tasasCambio={tasasCambio || []}
    />
  );
}

