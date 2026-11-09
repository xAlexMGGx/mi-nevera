import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ChevronIcon } from '../components/icons'
import { Screen } from '../components/Screen'
import { Sheet } from '../components/Sheet'
import { Button, FullScreenLoader, LoadError, Message, TextField, buttonClass, focusRing } from '../components/ui'
import { useActiveHouseId, useHouseMutation, useHouses } from '../data/house'
import { useOffline } from '../lib/connectivity'
import { errorKey } from '../lib/errors'
import { supabase } from '../lib/supabase'

function CreateHouseSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const create = useHouseMutation((value: string) => supabase.rpc('create_house', { p_name: value }))

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    create.mutate(name, { onSuccess: onClose })
  }

  return (
    <Sheet title={t('houses.create')} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <TextField label={t('houses.name')} required maxLength={80} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
        {create.isError && <Message tone="error">{t(errorKey(create.error))}</Message>}
        <Button type="submit" disabled={create.isPending || !name.trim()}>
          {t('houses.createSubmit')}
        </Button>
      </form>
    </Sheet>
  )
}

export function HousesPage() {
  const { t } = useTranslation()
  const houses = useHouses()
  const activeId = useActiveHouseId()
  const offline = useOffline()
  const [creating, setCreating] = useState(false)

  function renderList() {
    if (houses.isPending) return <FullScreenLoader />
    if (houses.isLoadingError) return <LoadError onRetry={() => void houses.refetch()} />
    return (
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {houses.data.map((house) => (
            <li key={house.id}>
              <Link to={`/houses/${house.id}`} className={`flex min-h-16 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5 ${focusRing}`}>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold break-words">{house.name}</span>
                  <span className="block text-sm text-ink-muted">
                    {t(`houses.roles.${house.role}`)}
                    {house.id === activeId && ` · ${t('houses.current')}`}
                  </span>
                </span>
                <span className="text-ink-muted">
                  <ChevronIcon />
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Button disabled={offline} onClick={() => setCreating(true)}>
          {t('houses.create')}
        </Button>
        {offline ? (
          <Button variant="secondary" disabled>
            {t('houses.join')}
          </Button>
        ) : (
          <Link to="/join" className={buttonClass('secondary')}>
            {t('houses.join')}
          </Link>
        )}
        {creating && <CreateHouseSheet onClose={() => setCreating(false)} />}
      </div>
    )
  }

  return <Screen title={t('houses.title')} backTo="/settings" main={renderList()} />
}
