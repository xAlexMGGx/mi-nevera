import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { Screen } from '../components/Screen'
import { Button, Message, TextField } from '../components/ui'
import { useHouseMutation } from '../data/house'
import { formatInviteCode, inviteCodeLength, normalizeInviteCode } from '../domain/invite'
import { errorKey } from '../lib/errors'
import { clearPendingInvite } from '../lib/pendingInvite'
import { supabase } from '../lib/supabase'

/** Unirse a una casa, con el código escrito o abriendo el enlace de invitación. */
export function JoinPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { code: linkCode } = useParams()
  const [code, setCode] = useState(() => formatInviteCode(linkCode ?? ''))
  const join = useHouseMutation((value: string) => supabase.rpc('join_house', { p_code: value }))

  useEffect(() => clearPendingInvite(), [])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    join.mutate(normalizeInviteCode(code), { onSuccess: () => void navigate('/', { replace: true }) })
  }

  return (
    <Screen
      title={t('join.title')}
      backTo="/"
      main={
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-ink-muted">{t('join.body')}</p>
          <TextField
            label={t('join.code')}
            name="invite-code"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t('join.placeholder')}
            value={code}
            onChange={(event) => {
              setCode(formatInviteCode(event.target.value))
              join.reset()
            }}
          />
          {join.isError && <Message tone="error">{t(errorKey(join.error))}</Message>}
          <Button type="submit" disabled={join.isPending || normalizeInviteCode(code).length !== inviteCodeLength}>
            {t('join.submit')}
          </Button>
        </form>
      }
    />
  )
}
