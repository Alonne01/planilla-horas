import { describe, it, expect } from 'vitest'
import { filaPlanilla } from './excel-export'
import type { RegistroHoras } from '../db/database'

const at = (h: number, m = 0) => new Date(2026, 10, 6, h, m).getTime()

function reg(p: Partial<RegistroHoras>): RegistroHoras {
  return {
    id: 'x', fechaMs: at(12), entradaInicioMs: null, salidaInicioMs: null, entradaFinMs: null, salidaFinMs: null,
    lugarTrabajo: 'Campo', pernocte: 'NO', maneja: false, horasViaje: 0, observaciones: '', proyecto: '',
    esFeriado: false, esFeriadoTrabajado: false, esFrancoCompensatorio: false, esFrancoTrabajado: false,
    esAusenciaJustificada: false, esFaltaInjustificada: false, fechaCreacion: 0, ...p,
  }
}

describe('filaPlanilla (entró-salió · entró-salió)', () => {
  it('una franja 08–19 en Campo: C-D cargadas, E-F vacías, 11 h', () => {
    expect(filaPlanilla(reg({ entradaInicioMs: at(8), salidaInicioMs: at(19) })))
      .toEqual({ C: 8, D: 19, E: null, F: null, G: 11 })
  })

  it('en Base descuenta 1 h de almuerzo', () => {
    expect(filaPlanilla(reg({ lugarTrabajo: 'Base', entradaInicioMs: at(8), salidaInicioMs: at(17) })).G).toBe(8)
  })

  it('turno noche 20–08 se parte en 20→24 y 0→8 (12 h)', () => {
    expect(filaPlanilla(reg({ entradaInicioMs: at(20), salidaInicioMs: at(8) })))
      .toEqual({ C: 20, D: 24, E: 0, F: 8, G: 12 })
  })

  it('doble franja 05–10 · 16–23 (12 h)', () => {
    expect(filaPlanilla(reg({ entradaInicioMs: at(5), salidaInicioMs: at(10), entradaFinMs: at(16), salidaFinMs: at(23) })))
      .toEqual({ C: 5, D: 10, E: 16, F: 23, G: 12 })
  })

  it('doble franja 05–10 · 19–07: F va +24 y el total se topea en 16', () => {
    expect(filaPlanilla(reg({ entradaInicioMs: at(5), salidaInicioMs: at(10), entradaFinMs: at(19), salidaFinMs: at(7) })))
      .toEqual({ C: 5, D: 10, E: 19, F: 31, G: 16 })
  })
})
