import { createClient } from '@/lib/supabase/server';
import RegistrarView from '@/components/RegistrarView';

export default async function RegistrarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: tarjetas } = await supabase
    .from('tarjetas')
    .select('id, alias, ultimos_digitos, tipo_producto, moneda')
    .eq('usuario_id', user.id)
    .order('created_at', { ascending: true });

  const { data: categorias } = await supabase
    .from('categorias')
    .select('id, nombre, icono')
    .eq('usuario_id', user.id)
    .order('nombre', { ascending: true });

  const { data: movimientosFijos } = await supabase
    .from('movimientos_fijos')
    .select('*, categorias(nombre, icono), tarjetas(alias)')
    .eq('usuario_id', user.id)
    .order('dia_cobro', { ascending: true });

  const { data: comprasCuotas } = await supabase
    .from('compras_cuotas')
    .select('*')
    .eq('usuario_id', user.id)
    .order('fecha_primera_cuota', { ascending: false });

  return (
    <RegistrarView
      tarjetas={tarjetas || []}
      categorias={categorias || []}
      movimientosFijosIniciales={movimientosFijos || []}
      comprasCuotas={comprasCuotas || []}
    />
  );
}