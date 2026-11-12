import { buttonClass } from './ui'

interface PhotoButtonProps {
  label: string
  /** Abre directamente la cámara; sin ella, el móvil deja elegir también de la galería. */
  camera?: boolean
  variant?: 'primary' | 'secondary'
  disabled?: boolean
  className?: string
  onFile: (file: File) => void
}

/** Hacer o elegir una foto con el selector del sistema. */
export function PhotoButton({ label, camera, variant = 'primary', disabled, className = '', onFile }: PhotoButtonProps) {
  return (
    <label className={`${buttonClass(variant)} cursor-pointer ${disabled ? 'pointer-events-none opacity-50' : ''} ${className}`}>
      <input
        type="file"
        accept="image/*"
        capture={camera ? 'environment' : undefined}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Así se puede volver a elegir la misma foto.
          event.target.value = ''
          if (file) onFile(file)
        }}
      />
      {label}
    </label>
  )
}
