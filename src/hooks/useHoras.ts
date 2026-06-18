import { useEffect, useState, useCallback } from 'react'
import { db, shadowBackup, getSettings, type RegistroHoras } from '../db/database'
import { periodoStart, periodoEnd } from '../lib/diagrama'

export function useHoras(mes: number, anio: number) {
  const [registros, setRegistros] = useState<RegistroHoras[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    // OJO: NO ponemos loading=true acá. Si lo hiciéramos, cada reload (al aplicar/copiar/borrar días)
    // desmontaría el calendario y volvería a correr toda la cascada de entrada → "reaparece". El loader
    // de pantalla completa sólo aplica al PRIMER load (useState(true)); los reloads actualizan en su lugar.
    const start = periodoStart(mes, anio).getTime()
    const end = periodoEnd(mes, anio).getTime() + 86_400_000 // end of day 20
    const rows = await db.registros
      .where('fechaMs')
      .between(start, end, true, true)
      .sortBy('fechaMs')
    setRegistros(rows)
    setLoading(false)
  }, [mes, anio])

  useEffect(() => { reload() }, [reload])

  const upsert = useCallback(async (reg: RegistroHoras) => {
    await db.registros.put(reg)
    await shadowBackup()
    await reload()
  }, [reload])

  const remove = useCallback(async (id: string) => {
    await db.registros.delete(id)
    await shadowBackup()
    await reload()
  }, [reload])

  /** All registers ever (for franco compensatorio counter) */
  const getAllForCounter = useCallback(async () => {
    return db.registros.toArray()
  }, [])

  return { registros, loading, reload, upsert, remove, getAllForCounter }
}

/**
 * Francos compensatorios disponibles (ganados por franco trabajado − usados).
 * Recibe `registros` del período visible como dependencia: cada alta/edición/borrado
 * dispara un reload de registros, y eso refresca el contador al instante.
 */
export function useFrancoCounter(registros: RegistroHoras[] = []) {
  const [disponibles, setDisponibles] = useState(0)

  useEffect(() => {
    Promise.all([db.registros.toArray(), getSettings()]).then(([all, s]) => {
      const ganados = all.filter(r => r.esFrancoTrabajado).length
      const usados = all.filter(r => r.esFrancoCompensatorio).length
      // Sumar el saldo arrastrado de los meses ya podados (>6 meses) para no perder esos francos.
      setDisponibles((s.francosCompSaldoBase ?? 0) + ganados - usados)
    })
  }, [registros])

  return disponibles
}
