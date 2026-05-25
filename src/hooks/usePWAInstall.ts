import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Capture the prompt at module load — fires long before any component mounts
let _prompt: BeforeInstallPromptEvent | null = null
const _subs = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault()
    _prompt = e as BeforeInstallPromptEvent
    _subs.forEach(fn => fn())
  })
}

export function usePWAInstall() {
  const [, tick] = useState(0)
  const [isInstalled, setIsInstalled] = useState(false)
  // iPad in desktop-mode reports "Macintosh" UA — detect via touch capability
  const isIOS = (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Mac') && 'ontouchend' in document)) &&
    !(window as any).MSStream

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true)
      return
    }
    const notify = () => tick(n => n + 1)
    _subs.add(notify)
    return () => { _subs.delete(notify) }
  }, [])

  async function install() {
    if (!_prompt) return
    const p = _prompt
    _prompt = null          // always clear before calling .prompt()
    _subs.forEach(fn => fn())
    try {
      await p.prompt()
      const { outcome } = await p.userChoice
      if (outcome === 'accepted') setIsInstalled(true)
    } catch {
      // prompt already consumed or dismissed — safe to ignore
    }
  }

  return { canInstall: !!_prompt, install, isInstalled, isIOS }
}
