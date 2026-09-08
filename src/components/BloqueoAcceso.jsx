export default function BloqueoAcceso({ info }) {
  const email = process.env.NEXT_PUBLIC_CONTACTO_EMAIL;
  const whatsapp = process.env.NEXT_PUBLIC_CONTACTO_WHATSAPP;

  const fechaFormateada = info.fecha_vencimiento
    ? new Date(info.fecha_vencimiento).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const mensajeWhatsapp = encodeURIComponent('Hola, mi acceso a Ábaco venció y quisiera renovarlo.');
  const asuntoCorreo = encodeURIComponent('Renovación de acceso - Ábaco');
  const hrefCorreo = `https://mail.google.com/mail/?view=cm&fs=1&to=${email}&su=${asuntoCorreo}`;

  return (
    <main className="min-h-screen flex items-center justify-center bg-navy-900 px-4">
      <div className="w-full max-w-sm bg-navy-800 border border-navy-700 rounded-xl p-8 text-center">
        <h1 className="text-offwhite text-xl font-semibold mb-2">Tu acceso venció</h1>
        <p className="text-navy-400 text-sm mb-1">
          {fechaFormateada ? `Tu suscripción venció el ${fechaFormateada}.` : 'Tu suscripción ya no está activa.'}
        </p>
        <p className="text-navy-400 text-sm mb-6">
          Contáctanos para renovar tu acceso.
        </p>

        <div className="flex flex-col gap-3">
          {whatsapp && (
            <a
              href={`https://wa.me/${whatsapp}?text=${mensajeWhatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 rounded-lg bg-success text-navy-900 font-semibold text-sm"
            >
              Escribir por WhatsApp
            </a>
          )}
          {email && (
            <a
              href={hrefCorreo}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 rounded-lg border border-navy-700 text-navy-400 font-medium text-sm"
            >
              Escribir por correo
            </a>
          )}
        </div>
      </div>
    </main>
  );
}