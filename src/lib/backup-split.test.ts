import { describe, it, expect } from 'vitest'
import { partirSettings, combinarSettings, SALARY_FIELDS } from './backup-split'
import { DEFAULT_SETTINGS } from '../db/database'

const settings = {
  ...DEFAULT_SETTINGS,
  nombreUsuario: 'Juan',
  sueldoBasico: 999999,
  convenio: 'CCT_644_12' as const,
  backupCodigo: '123456',
}

describe('partirSettings', () => {
  it('el sueldo y el código NO están en shared', () => {
    const { shared } = partirSettings(settings)
    for (const f of SALARY_FIELDS) expect(shared).not.toHaveProperty(f)
    expect(shared).not.toHaveProperty('backupCodigo')
    expect(shared.nombreUsuario).toBe('Juan')
  })
  it('el sueldo y el código SÍ están en salary', () => {
    const { salary } = partirSettings(settings)
    expect(salary.sueldoBasico).toBe(999999)
    expect(salary.backupCodigo).toBe('123456')
  })
})

describe('combinarSettings (round-trip)', () => {
  it('reconstruye los settings originales', () => {
    const { shared, salary } = partirSettings(settings)
    expect(combinarSettings(shared, salary)).toEqual(settings)
  })
  it('sin salary, el sueldo queda en defaults (caso PC)', () => {
    const { shared } = partirSettings(settings)
    const soloShared = combinarSettings(shared, {})
    expect(soloShared.sueldoBasico).toBe(DEFAULT_SETTINGS.sueldoBasico) // 0
    expect(soloShared.backupCodigo).toBe('') // el código nunca llega a la PC
    expect(soloShared.nombreUsuario).toBe('Juan')
  })
})
