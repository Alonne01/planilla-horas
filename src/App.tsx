import { useState, useEffect } from "react"
import { Clock, Settings2, Banknote, RefreshCw, AlertTriangle } from "lucide-react"
import { HorasTrabajoPage } from "./pages/HorasTrabajo"
import { SettingsPage } from "./pages/Settings"
import { ProyeccionSalarialPage } from "./pages/ProyeccionSalarial"
import { restoreFromShadow } from "./db/database"
import "./index.css"

const SHOW_SALARY = import.meta.env.VITE_SHOW_SALARY === "true"

type Tab = "horas" | "settings" | "salary"
const TAB_ORDER: Tab[] = ["horas", "settings", "salary"]

function goToTab(next: Tab, current: Tab, setter: (t: Tab) => void) {
  if (next === current) return
  const isBack = TAB_ORDER.indexOf(next) < TAB_ORDER.indexOf(current)
  if ("startViewTransition" in document) {
    if (isBack) document.documentElement.classList.add("vt-back")
    else document.documentElement.classList.remove("vt-back")
    const t = (document as any).startViewTransition(() => setter(next))
    t.finished?.then(() => document.documentElement.classList.remove("vt-back"))
               ?.catch(() => document.documentElement.classList.remove("vt-back"))
  } else {
    setter(next)
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>("horas")
  const [recovered, setRecovered] = useState(false)
  const [persistDenied, setPersistDenied] = useState(false)

  useEffect(() => {
    async function init() {
      const didRecover = await restoreFromShadow()
      if (didRecover) setRecovered(true)

      if (navigator.storage?.persist) {
        const granted = await navigator.storage.persist()
        if (!granted) setPersistDenied(true)
      }
    }
    init()
  }, [])

  return (
    <div className="max-w-lg mx-auto min-h-screen relative">
      <div className="pb-16 vt-page-content">
        {recovered && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-blue-900/40 text-blue-300 text-sm flex items-start gap-2">
            <RefreshCw size={18} className="shrink-0 mt-0.5" />
            <span>Datos recuperados automáticamente desde el respaldo local.</span>
          </div>
        )}
        {persistDenied && !recovered && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-amber-900/40 text-amber-300 text-sm flex items-start gap-2">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <span>El almacenamiento persistente no fue otorgado. Hacé backup periódicamente desde Configuración.</span>
          </div>
        )}
        {tab === "horas" && <HorasTrabajoPage />}
        {tab === "settings" && <SettingsPage />}
        {tab === "salary" && SHOW_SALARY && <ProyeccionSalarialPage />}
      </div>

      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-slate-900/95 backdrop-blur border-t border-slate-800 z-30">
        <div className="flex">
          <NavTab icon={<Clock size={22} />} label="Horas" active={tab === "horas"} onClick={() => goToTab("horas", tab, setTab)} />
          <NavTab icon={<Settings2 size={22} />} label="Config" active={tab === "settings"} onClick={() => goToTab("settings", tab, setTab)} />
          {SHOW_SALARY && (
            <NavTab icon={<Banknote size={22} />} label="Sueldo" active={tab === "salary"} onClick={() => goToTab("salary", tab, setTab)} />
          )}
        </div>
      </nav>
    </div>
  )
}

function NavTab({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={"flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors " + (active ? "text-blue-400" : "text-slate-500")}
    >
      <span className="leading-none">{icon}</span>
      <span className="text-xs">{label}</span>
    </button>
  )
}
