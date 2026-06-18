/**
 * Fondo decorativo: "blobs" de color muy tenues que derivan lento, para dar profundidad sin distraer.
 * Se monta como capa con z NEGATIVO dentro de un contenedor `relative isolate` (queda detrás del
 * contenido pero por encima del color de fondo de la pantalla). Reutiliza los keyframes blob-drift-*.
 */
export function BgBlobs() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-16 top-8 h-64 w-64 rounded-full bg-blue-600/10 blur-3xl animate-[blob-drift-a_19s_ease-in-out_infinite]" />
      <div className="absolute -right-20 top-1/3 h-72 w-72 rounded-full bg-indigo-600/10 blur-3xl animate-[blob-drift-b_23s_ease-in-out_infinite]" />
      <div className="absolute bottom-4 left-1/4 h-64 w-64 rounded-full bg-sky-600/[0.08] blur-3xl animate-[blob-drift-c_21s_ease-in-out_infinite]" />
    </div>
  )
}
