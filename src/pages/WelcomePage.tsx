import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthLayout } from '../components/AuthLayout'
import { Button, Message, TextField } from '../components/ui'
import { errorKey } from '../lib/errors'
import { supabase } from '../lib/supabase'

/** Primera vez: crea la casa. En la fase 2 ofrecerá también unirse a una con un código. */
export function WelcomePage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [name, setName] = useState(() => t('welcome.defaultName'))

  const createHouse = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('create_house', { p_name: name })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile'] }),
  })

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
    </AuthLayout>
  )
}
