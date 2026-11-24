import Link from 'next/link';

export default function AuthShell({ titulo, descripcion, children }) {
  return <main className="min-h-screen flex items-center justify-center px-4 py-10">
    <div className="w-full max-w-md">
      <Link href="/login" className="abaco-brand block mb-8">á<span>·</span>baco</Link>
      <section className="surface">
        <p className="eyebrow mb-3">Tu espacio seguro</p>
        <h1 className="text-2xl font-semibold">{titulo}</h1>
        <p className="text-navy-400 text-sm mt-3 mb-6">{descripcion}</p>
        {children}
      </section>
    </div>
  </main>;
}
