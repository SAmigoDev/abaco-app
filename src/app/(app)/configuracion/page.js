// src/app/(app)/configuracion/page.js
import { createClient } from '@/lib/supabase/server';
import ConfiguracionView from '@/components/ConfiguracionView';

export default async function ConfiguracionPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: tarjetas } = await supabase
    .from('tarjetas')
    .select('*')
    .eq('usuario_id', user.id)
    .order('created_at', { ascending: true });

  const { data: categorias } = await supabase
    .from('categorias')
    .select('*')
    .eq('usuario_id', user.id)
    .order('nombre', { ascending: true });

  const { data: perfil } = await supabase
    .from('usuarios')
    .select('regla_presupuesto_activa')
    .eq('id', user.id)
    .single();

  const { data: metas } = await supabase
    .from('metas_ahorro')
    .select('*')
    .eq('usuario_id', user.id)
    .order('created_at', { ascending: true });

  return (
    <ConfiguracionView
      tarjetasIniciales={tarjetas || []}
      categoriasIniciales={categorias || []}
      presupuestoActivoInicial={perfil?.regla_presupuesto_activa || false}
      metasIniciales={metas || []}
    />
  );
}