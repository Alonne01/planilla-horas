// Proyección Salarial — hidden behind VITE_SHOW_SALARY=true
// This page exists but is not reachable unless the env var is set

export function ProyeccionSalarialPage() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="text-center space-y-3">
        <div className="text-4xl">🚧</div>
        <h1 className="text-xl font-bold text-white">Proyección Salarial</h1>
        <p className="text-slate-400 text-sm max-w-xs">
          Esta función está disponible pero temporalmente oculta.
          Se habilitará una vez esté configurada para todos los convenios.
        </p>
      </div>
    </div>
  )
}
