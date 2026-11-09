import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useActiveHouse, useActiveHouseId, useHouses, useSwitchHouse } from '../data/house'
import { CheckIcon, ChevronDownIcon } from './icons'
import { Sheet } from './Sheet'
import { buttonClass, focusRing } from './ui'

/** Selector de casa de la cabecera (SPEC §6). */
export function HouseSwitcher() {
  const { t } = useTranslation()
  const { data: house } = useActiveHouse()
  const activeId = useActiveHouseId()
  const houses = useHouses()
  const switchHouse = useSwitchHouse()
  const [open, setOpen] = useState(false)
  const name = house?.name ?? t('app.name')

  return (
    <>
      <h1 className="flex min-w-0 flex-1 px-1">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={t('houses.open', { name })}
          onClick={() => setOpen(true)}
          className={`flex min-h-11 max-w-full items-center gap-1 rounded-lg px-1 text-lg font-bold active:opacity-70 ${focusRing}`}
        >
          <span className="truncate">{name}</span>
          <ChevronDownIcon />
        </button>
      </h1>
      {open && (
        <Sheet title={t('houses.choose')} onClose={() => setOpen(false)}>
          <ul className="flex flex-col divide-y divide-line">
            {(houses.data ?? []).map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  aria-current={option.id === activeId}
                  onClick={() => {
                    if (option.id !== activeId) switchHouse(option.id)
                    setOpen(false)
                  }}
                  className={`flex min-h-12 w-full items-center gap-3 py-2 text-left font-medium active:opacity-70 ${focusRing}`}
                >
                  <span className="min-w-0 flex-1 break-words">{option.name}</span>
                  {option.id === activeId && (
                    <span className="text-brand">
                      <CheckIcon />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <Link to="/houses" className={buttonClass('secondary')}>
            {t('houses.manage')}
          </Link>
        </Sheet>
      )}
    </>
  )
}
