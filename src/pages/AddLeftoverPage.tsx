import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Screen } from '../components/Screen'
import { Button, FullScreenLoader, LoadError, Message, SelectField, Stepper, TextField } from '../components/ui'
import { useDateContext } from '../data/context'
import { useActiveHouseId } from '../data/house'
import { useInventory, useInventoryAction } from '../data/inventory'
import { parseAmount } from '../domain/quantity'
import { zoneKinds, type ZoneKind } from '../domain/types'
import { supabase } from '../lib/supabase'

export function AddLeftoverPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { today } = useDateContext()
  const houseId = useActiveHouseId()
  const inventory = useInventory()
  const { run, pending, errorKey } = useInventoryAction({ inlineErrors: true })

  const nextNumber = useQuery({
    queryKey: ['nextContainer', houseId],
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('next_container_number', { p_house_id: houseId })
      if (error) throw error
      return data
    },
  })

  const [name, setName] = useState('')
  const [servings, setServings] = useState(1)
  const [cookedAt, setCookedAt] = useState(today)
  const [zone, setZone] = useState<ZoneKind>('fridge')
  // Vacío significa "el número libre más bajo", que lo asigna el servidor al guardar.
  const [number, setNumber] = useState('')
  const [reminderDate, setReminderDate] = useState('')

  if (inventory.isPending) return <FullScreenLoader />
  if (inventory.isError) return <LoadError onRetry={() => void inventory.refetch()} />

  const zones = inventory.data.zones
  const typedNumber = parseAmount(number)
  const invalidNumber = number.trim() !== '' && (!typedNumber || typedNumber < 1 || !Number.isInteger(typedNumber))

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (invalidNumber) return

    const done = await run('cooked', () =>
      supabase.rpc('add_cooked_dish', {
        p_house_id: houseId,
        p_zone_id: zones.find((row) => row.kind === zone)!.id,
        p_name: name,
        p_servings: servings,
        p_cooked_at: cookedAt || undefined,
        p_container_number: typedNumber ?? undefined,
        p_reminder_date: reminderDate || undefined,
      }),
    )
    if (done) void navigate('/', { replace: true })
  }

  return (
    <Screen
      title={t('leftover.title')}
      backTo="/add"
      main={
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
          <TextField label={t('leftover.name')} required maxLength={80} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
          <Stepper label={t('leftover.servings')} value={servings} min={1} onChange={setServings} />
          <TextField label={t('leftover.cookedAt')} type="date" value={cookedAt} onChange={(event) => setCookedAt(event.target.value)} />
          <SelectField label={t('form.zone')} value={zone} onChange={(event) => setZone(event.target.value as ZoneKind)}>
            {zoneKinds.map((value) => (
              <option key={value} value={value}>
                {t(`zones.${value}`)}
              </option>
            ))}
          </SelectField>
          <TextField
            label={t('leftover.containerNumber')}
            hint={t('leftover.containerHint')}
            inputMode="numeric"
            placeholder={nextNumber.data ? String(nextNumber.data) : undefined}
            value={number}
            onChange={(event) => setNumber(event.target.value)}
          />
          <TextField label={t('form.reminder')} hint={t('form.reminderHint')} type="date" value={reminderDate} onChange={(event) => setReminderDate(event.target.value)} />

          {invalidNumber && <Message tone="error">{t('leftover.invalidNumber')}</Message>}
          {errorKey && <Message tone="error">{t(errorKey)}</Message>}

          <Button type="submit" disabled={pending || !name.trim()}>
            {t('leftover.submit')}
          </Button>
        </form>
      }
    />
  )
}
