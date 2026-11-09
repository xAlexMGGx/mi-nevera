import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { useUser } from '../auth/AuthProvider'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { PencilIcon } from '../components/icons'
import { Screen, topBarIcon } from '../components/Screen'
import { Sheet } from '../components/Sheet'
import { useShowError } from '../components/Toast'
import { ActionChip, Button, Card, FullScreenLoader, LoadError, Message, TextField } from '../components/ui'
import { useDateContext } from '../data/context'
import { useActiveHouseId, useHouseInvites, useHouseMembers, useHouseMutation, useHouses, useSwitchHouse, type MyHouse } from '../data/house'
import { formatDayMonth, todayIn } from '../domain/dates'
import { formatInviteCode, inviteLink } from '../domain/invite'
import { useOffline } from '../lib/connectivity'
import { errorKey } from '../lib/errors'
import { supabase } from '../lib/supabase'

function RenameHouseSheet({ house, onClose }: { house: MyHouse; onClose: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(house.name)
  const rename = useHouseMutation((value: string) => supabase.rpc('rename_house', { p_house_id: house.id, p_name: value }))

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    rename.mutate(name, { onSuccess: onClose })
  }

  return (
    <Sheet title={t('houses.renameTitle')} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <TextField label={t('houses.name')} required maxLength={80} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
        {rename.isError && <Message tone="error">{t(errorKey(rename.error))}</Message>}
        <Button type="submit" disabled={rename.isPending || !name.trim()}>
          {t('common.save')}
        </Button>
      </form>
    </Sheet>
  )
}

function MembersCard({ house }: { house: MyHouse }) {
  const { t } = useTranslation()
  const { id: userId } = useUser()
  const offline = useOffline()
  const members = useHouseMembers(house.id)
  const [expelling, setExpelling] = useState<{ id: string; name: string } | null>(null)
  const expel = useHouseMutation((memberId: string) => supabase.rpc('remove_member', { p_house_id: house.id, p_user_id: memberId }))

  return (
    <Card>
      <h2 className="font-semibold">{t('houses.members')}</h2>
      {members.isPending && <p className="text-ink-muted">{t('app.loading')}</p>}
      {members.isLoadingError && <LoadError onRetry={() => void members.refetch()} />}
      {members.data && (
        <ul className="flex flex-col divide-y divide-line">
          {members.data.map((member) => (
            <li key={member.user_id} className="flex min-h-14 items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block font-medium break-words">
                  {member.display_name || t('houses.noName')}
                  {member.user_id === userId && <span className="font-normal text-ink-muted"> ({t('houses.you')})</span>}
                </span>
                <span className="block text-sm text-ink-muted">{t(`houses.roles.${member.role}`)}</span>
              </span>
              {house.role === 'owner' && member.user_id !== userId && (
                <ActionChip disabled={offline} onClick={() => setExpelling({ id: member.user_id, name: member.display_name || t('houses.thisPerson') })}>
                  {t('houses.expel')}
                </ActionChip>
              )}
            </li>
          ))}
        </ul>
      )}
      {expelling && (
        <ConfirmSheet
          title={t('houses.expelTitle', { name: expelling.name })}
          body={t('houses.expelBody')}
          submit={t('houses.expel')}
          pending={expel.isPending}
          error={expel.error}
          onConfirm={() => expel.mutate(expelling.id, { onSuccess: () => setExpelling(null) })}
          onClose={() => setExpelling(null)}
        />
      )}
    </Card>
  )
}

function InviteRow({ house, invite }: { house: MyHouse; invite: { id: string; code: string; expires_at: string } }) {
  const { t } = useTranslation()
  const showError = useShowError()
  const offline = useOffline()
  const { timezone } = useDateContext()
  const [copied, setCopied] = useState(false)
  const revoke = useHouseMutation(() => supabase.rpc('revoke_invite', { p_invite_id: invite.id }))
  const code = formatInviteCode(invite.code)

  async function share() {
    const text = t('houses.invite.shareText', { house: house.name, code })
    const url = inviteLink(invite.code, window.location.origin, import.meta.env.BASE_URL)
    try {
      if (navigator.share) {
        await navigator.share({ text, url })
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`)
        setCopied(true)
      }
    } catch (error) {
      // Cerrar la ventana de compartir también llega como un error.
      if ((error as Error).name !== 'AbortError') showError(error)
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl bg-canvas p-3">
      <p className="font-mono text-2xl font-bold tracking-widest break-all select-all">{code}</p>
      <p className="text-sm text-ink-muted">{t('houses.invite.expires', { date: formatDayMonth(todayIn(timezone, new Date(invite.expires_at))) })}</p>
      {copied && <Message tone="success">{t('houses.invite.copied')}</Message>}
      {revoke.isError && <Message tone="error">{t(errorKey(revoke.error))}</Message>}
      <div className="flex flex-wrap gap-1.5">
        <ActionChip onClick={() => void share()}>{t('houses.invite.share')}</ActionChip>
        <ActionChip disabled={offline || revoke.isPending} onClick={() => revoke.mutate()}>
          {t('houses.invite.revoke')}
        </ActionChip>
      </div>
    </li>
  )
}

function InvitesCard({ house }: { house: MyHouse }) {
  const { t } = useTranslation()
  const offline = useOffline()
  const invites = useHouseInvites(house.id, true)
  const create = useHouseMutation(() => supabase.rpc('create_invite', { p_house_id: house.id }))

  return (
    <Card>
      <h2 className="font-semibold">{t('houses.invite.title')}</h2>
      <p className="text-sm text-ink-muted">{t('houses.invite.body')}</p>
      {invites.isLoadingError && <LoadError onRetry={() => void invites.refetch()} />}
      {invites.data && invites.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {invites.data.map((invite) => (
            <InviteRow key={invite.id} house={house} invite={invite} />
          ))}
        </ul>
      )}
      {create.isError && <Message tone="error">{t(errorKey(create.error))}</Message>}
      <Button variant="secondary" disabled={offline || create.isPending} onClick={() => create.mutate()}>
        {t('houses.invite.create')}
      </Button>
    </Card>
  )
}

type Sheets = 'rename' | 'leave' | 'delete'

export function HousePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams()
  const houses = useHouses()
  const activeId = useActiveHouseId()
  const switchHouse = useSwitchHouse()
  const offline = useOffline()
  const [sheet, setSheet] = useState<Sheets | null>(null)
  const house = houses.data?.find((row) => row.id === id)
  const members = useHouseMembers(id ?? '')
  const leave = useHouseMutation(() => supabase.rpc('leave_house', { p_house_id: id ?? '' }))
  const remove = useHouseMutation(() => supabase.rpc('delete_house', { p_house_id: id ?? '' }))
  const goHome = () => void navigate('/', { replace: true })

  if (houses.isPending) return <FullScreenLoader />
  if (houses.isLoadingError) return <Screen title={t('houses.title')} backTo="/houses" main={<LoadError onRetry={() => void houses.refetch()} />} />
  if (!house) {
    return <Screen title={t('houses.title')} backTo="/houses" main={<p className="py-12 text-center text-ink-muted">{t('houses.notFound')}</p>} />
  }

  const isOwner = house.role === 'owner'
  // Quien está en solitario no puede "salir": es lo mismo que borrar la casa, y eso se dice claro.
  const alone = members.data?.length === 1

  return (
    <Screen
      title={house.name}
      backTo="/houses"
      action={
        isOwner && !offline ? (
          <button type="button" aria-label={t('houses.rename')} onClick={() => setSheet('rename')} className={topBarIcon}>
            <PencilIcon />
          </button>
        ) : undefined
      }
      main={
        <div className="flex flex-col gap-4">
          {house.id !== activeId && <Button onClick={() => switchHouse(house.id)}>{t('houses.use')}</Button>}
          <MembersCard house={house} />
          {isOwner && <InvitesCard house={house} />}
          {!alone && members.data && (
            <Button variant="secondary" disabled={offline} onClick={() => setSheet('leave')}>
              {t('houses.leave')}
            </Button>
          )}
          {isOwner && (
            <Button variant="danger" disabled={offline} onClick={() => setSheet('delete')}>
              {t('houses.delete')}
            </Button>
          )}

          {sheet === 'rename' && <RenameHouseSheet house={house} onClose={() => setSheet(null)} />}
          {sheet === 'leave' && (
            <ConfirmSheet
              title={t('houses.leaveTitle', { name: house.name })}
              body={isOwner ? t('houses.leaveBodyOwner') : t('houses.leaveBody')}
              submit={t('houses.leaveSubmit')}
              pending={leave.isPending}
              error={leave.error}
              onConfirm={() => leave.mutate(undefined, { onSuccess: goHome })}
              onClose={() => setSheet(null)}
            />
          )}
          {sheet === 'delete' && (
            <ConfirmSheet
              title={t('houses.deleteTitle', { name: house.name })}
              body={t('houses.deleteBody')}
              submit={t('houses.deleteSubmit')}
              pending={remove.isPending}
              error={remove.error}
              typeToConfirm={{ label: t('houses.deleteType', { name: house.name }), text: house.name }}
              onConfirm={() => remove.mutate(undefined, { onSuccess: goHome })}
              onClose={() => setSheet(null)}
            />
          )}
        </div>
      }
    />
  )
}
