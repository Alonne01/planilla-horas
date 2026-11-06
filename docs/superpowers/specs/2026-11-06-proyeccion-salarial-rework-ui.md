# Rework UI — Proyección Salarial (pulir las 3 pestañas)

Fecha: 2026-11-06 · Alcance: sólo presentación (`src/pages/ProyeccionSalarial.tsx`, `src/components/SalaryCharts.tsx`). No cambia ningún cálculo.

## Problemas
- Dos números grandes compiten: "Neto estimado" (a la fecha) en el hero y "Proyección fin de período" en Resumen.
- Valor hora repetido (hero + KPI).
- El desglose tipo recibo está escondido; "Contrastar recibo" cuelga al pie de las 3 pestañas.

## Diseño aprobado
1. **Hero**: período en curso → "VAS A COBRAR (est.)" = neto proyectado + barra "Cobrado hasta hoy $X · faltan ~N días de trabajo". Período cerrado → "NETO ESTIMADO" sin barra. Mini-datos: Bruto · Retenciones · Días trabajados. Festejo/tragaperras sobre el número protagonista.
2. **Resumen**: sin ProyeccionCard (ya está en el hero). KPIs: $/hora, $/día, % extras, variables campo. Distribución operativa compacta + fila de horas (normales/50/100/viaje/noct.).
3. **Análisis**: orden acumulado → composición → ganancia/día → tendencia. Con <2 meses la tendencia es una línea de texto.
4. **Desglose**: una tarjeta tipo recibo (fijos / variables / no rem. / descuentos con subtotales) y pie Bruto − Retenciones = Neto. Nota de estimación en desplegable. "Contrastar recibo (PDF)" vive acá.
5. **Visual**: tarjetas y títulos consistentes, montos tabulares, sin emojis.
