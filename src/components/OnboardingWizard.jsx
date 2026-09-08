// src/components/OnboardingWizard.jsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import TarjetaForm from '@/components/TarjetaForm';

export default function OnboardingWizard() {
  const [paso, setPaso] = useState('bienvenida');
  const [tarjetasAgregadas, setTarjetasAgregadas] = useState(0);
  const router = useRouter();

  function alGuardarTarjeta() {
    setTarjetasAgregadas((n) => n + 1);
    setPaso('otra_tarjeta');
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-navy-900 px-4">
      <div className="w-full max-w-md bg-navy-800 border border-navy-700 rounded-xl p-8">
        {paso === 'bienvenida' && (
          <>
            <h1 className="text-offwhite text-2xl font-semibold mb-2">¡Bienvenido a Ábaco!</h1>
            <p className="text-navy-400 text-sm mb-6">Vamos a configurar tu cuenta en unos pasos. Empecemos agregando tu primera tarjeta o cuenta.</p>
            <button onClick={() => setPaso('formulario_tarjeta')} className="w-full py-2.5 rounded-lg bg-gold text-navy-900 font-semibold text-sm">
              Comenzar
            </button>
          </>
        )}

        {paso === 'formulario_tarjeta' && (
          <>
            <h1 className="text-offwhite text-xl font-semibold mb-4">
              {tarjetasAgregadas === 0 ? 'Agrega tu primera tarjeta' : 'Agrega otra tarjeta'}
            </h1>
            <TarjetaForm onGuardado={alGuardarTarjeta} textoBoton="Guardar tarjeta" />
          </>
        )}

        {paso === 'otra_tarjeta' && (
          <>
            <h1 className="text-offwhite text-xl font-semibold mb-2">Tarjeta agregada ✅</h1>
            <p className="text-navy-400 text-sm mb-6">
              Llevas {tarjetasAgregadas} tarjeta{tarjetasAgregadas === 1 ? '' : 's'} registrada{tarjetasAgregadas === 1 ? '' : 's'}. ¿Quieres agregar otra?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setPaso('formulario_tarjeta')} className="flex-1 py-2.5 rounded-lg border border-navy-700 text-navy-400 font-medium text-sm">
                Sí, agregar otra
              </button>
              <button onClick={() => setPaso('finalizar')} className="flex-1 py-2.5 rounded-lg bg-gold text-navy-900 font-semibold text-sm">
                No, continuar
              </button>
            </div>
          </>
        )}

        {paso === 'finalizar' && (
          <>
            <h1 className="text-offwhite text-xl font-semibold mb-2">¡Todo listo!</h1>
            <p className="text-navy-400 text-sm mb-6">Ya puedes empezar a registrar tus gastos.</p>
            <button onClick={() => router.refresh()} className="w-full py-2.5 rounded-lg bg-gold text-navy-900 font-semibold text-sm">
              Ir al Dashboard
            </button>
          </>
        )}
      </div>
    </main>
  );
}