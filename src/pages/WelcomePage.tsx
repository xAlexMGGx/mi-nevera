import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { AuthLayout } from '../components/AuthLayout'
import { Button, Message, TextField, buttonClass } from '../components/ui'
import { useHouseMutation } from '../data/house'
import { errorKey } from '../lib/errors'
import { supabase } from '../lib/supabase'

/** Primera vez: crea tu casa o únete a la de otra persona con un código. */
export function WelcomePage() {
  const { t } = useTranslation()
  const [name, setName] = useState(() => t('welcome.defaultName'))
  const createHouse = useHouseMutation(() => supabase.rpc('create_house', { p_name: name }))

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    createHouse.mutate()
  }

  return (
    <AuthLayout title={t('welcome.title')}>
      <p className="text-ink-muted">{t('welcome.body')}</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField
          label={t('welcome.nameLabel')}
          name="house"
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {createHouse.isError && <Message tone="error">{t(errorKey(createHouse.error))}</Message>}
        <Button type="submit" disabled={createHouse.isPending || !name.trim()}>
          {t('welcome.submit')}
        </Button>
      </form>
      <Link to="/join" className={buttonClass('secondary')}>
        {t('welcome.join')}
      </Link>
    </AuthLayout>
  )
}
