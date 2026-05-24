import { useState, useEffect } from "react"
import { HorasTrabajoPage } from "./pages/HorasTrabajo"
import { SettingsPage } from "./pages/Settings"
import { ProyeccionSalarialPage } from "./pages/ProyeccionSalarial"
import { requestPersistentStorage } from "./db/database"
import "./index.css"

const SHOW_SALARY = import.meta.env.VITE_SHOW_SALARY === "true"

type Tab = "horas" | "settings" | "salary"

export default function App() {
  const [tab, setTab] = useState<Tab>("horas")

  useEffect(() => {
    requestPersistentStorage()
  }, [])

  return (
    <div className="max-w-lg mx-auto min-h-screen relative">
      <div className="pb-16">
        {tab === "horas" && <HorasTrabajoPage />}
        {tab === "settings" && <SettingsPage />}
        {tab === "salary" && SHOW_SALARY && <ProyeccionSalarialPage />}
      </div>

      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-slate-900/95 backdrop-blur border-t border-slate-800 z-30">
        <div className="flex">
          <NavTab icon="📋" label="Horas" active={tab === "horas"} onClick={() => setTab("horas")} />
          <NavTab icon="⚙️" label="Config" active={tab === "settings"} onClick={() => setTab("settings")} />
          {SHOW_SALARY && (
            <NavTab icon="💰" label="Sueldo" active={tab === "salary"} onClick={() => setTab("salary")} />
          )}
        </div>
      </nav>
    </div>
  )
}

function NavTab({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={"flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors " + (active ? "text-blue-400" : "text-slate-500")}
    >
      <span className="text-xl leading-none">{icon}</span>
      <span className="text-xs">{label}</span>
    </button>
  )
}
