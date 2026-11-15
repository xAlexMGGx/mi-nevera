import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BrandPhoto } from '../domain/photos'
import { ProductPhoto } from './ProductPhoto'

/** Carrusel deslizable con la foto de cada marca (SPEC §12). */
export function PhotoCarousel({ photos, icon }: { photos: BrandPhoto[]; icon: string }) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState(0)

  return (
    <div className="flex flex-col gap-2">
      <ul
        aria-label={t('product.photos')}
        onScroll={(event) => {
          const { scrollLeft, clientWidth } = event.currentTarget
          setCurrent(Math.round(scrollLeft / Math.max(1, clientWidth)))
        }}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-2xl border border-line bg-white [scrollbar-width:none]"
      >
        {photos.map((photo, index) => (
          <li key={`${photo.ref}-${index}`} className="relative w-full shrink-0 snap-center">
            <ProductPhoto src={photo.ref} icon={icon} className="aspect-[4/3] w-full" iconClassName="aspect-[4/3] w-full bg-canvas text-7xl" />
            {photos.length > 1 && (
              <span className="absolute bottom-2 left-2 rounded-full bg-ink/75 px-2.5 py-0.5 text-xs font-semibold text-canvas">
                {photo.brand ?? t('product.noBrand')}
              </span>
            )}
          </li>
        ))}
      </ul>
      {photos.length > 1 && (
        <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
          {photos.map((photo, index) => (
            <span key={`${photo.ref}-dot-${index}`} className={`size-2 rounded-full ${index === current ? 'bg-brand' : 'bg-line'}`} />
          ))}
        </div>
      )}
      {photos.length > 1 && <p className="sr-only">{t('product.photoOf', { current: current + 1, total: photos.length })}</p>}
    </div>
  )
}
