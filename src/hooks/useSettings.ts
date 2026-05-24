import { useEffect, useState, useCallback } from 'react'
import { getSettings, saveSettings, type AppSettings, DEFAULT_SETTINGS } from '../db/database'

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    getSettings().then(s => {
      setSettings(s)
      setLoaded(true)
    })
  }, [])

  const update = useCallback(async (partial: Partial<AppSettings>) => {
    await saveSettings(partial)
    const updated = await getSettings()
    setSettings(updated)
  }, [])

  return { settings, loaded, update }
}
