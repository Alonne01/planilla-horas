import { Construction } from 'lucide-react'

export function ProyeccionSalarialPage() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="text-center space-y-3">
        <div className="flex justify-center text-slate-500"><Construction size={48} /></div>
        <h1 className="text-xl font-bold text-white">Proyección Salarial</h1>
        <p className="text-slate-400 text-sm max-w-xs">
          Esta función está disponible pero temporalmente oculta.
          Se habilitará una vez esté configurada para todos los convenios.
        </p>
      </div>
    </div>
  )
}
