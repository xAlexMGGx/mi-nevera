import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Screen } from '../components/Screen'
import { Button, Card, Message, SelectField, Stepper } from '../components/ui'
import { useOffline } from '../lib/connectivity'
import { errorKey } from '../lib/errors'
import { useProfile, useUpdateProfile } from '../profile/useProfile'
import {
  currentSubscription,
  notificationPermission,
  pushSupport,
  sendTestNotification,
  subscribeThisDevice,
  unsubscribeThisDevice,
} from '../push/push'

const hours = Array.from({ length: 24 }, (_, hour) => hour)
const maxDaysAhead = 14

function deviceTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function DeviceCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const offline = useOffline()
  const updateProfile = useUpdateProfile()
  const support = pushSupport()

  const subscription = useQuery({
    queryKey: ['pushSubscription'],
    enabled: support === 'ready',
    queryFn: async () => Boolean(await currentSubscription()),
  })

  const enable = useMutation({
    mutationFn: async () => {
      const result = await subscribeThisDevice()
      // El aviso llega a la hora de donde está el móvil, también fuera de la península.
      if (result === 'subscribed') await updateProfile.mutateAsync({ timezone: deviceTimezone() })
      return result
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['pushSubscription'] }),
  })
  const disable = useMutation({
    mutationFn: unsubscribeThisDevice,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['pushSubscription'] }),
  })
  const test = useMutation({ mutationFn: sendTestNotification })

  const permission = notificationPermission()
  const busy = enable.isPending || disable.isPending
  // Mientras se activa, el navegador ya tiene la suscripción pero el servidor aún no.
  const subscribed = subscription.data === true && !busy

  function status() {
    if (support === 'not-configured') return t('notifications.status.notConfigured')
    if (support === 'unsupported') return t('notifications.status.unsupported')
    if (support === 'needs-install') return t('notifications.status.needsInstall')
    if (permission === 'denied' || enable.data === 'denied') return t('notifications.status.denied')
    return subscribed ? t('notifications.status.on') : t('notifications.status.off')
  }

  function testMessage() {
    if (!test.data) return null
    if (test.data.sent > 0) return <Message tone="success">{t('notifications.testSent')}</Message>
    if (test.data.failed > 0) return <Message tone="error">{t('notifications.testFailed')}</Message>
    return <Message tone="error">{t('notifications.testNone')}</Message>
  }

  const error = enable.error ?? disable.error ?? test.error

  return (
    <Card>
      <h2 className="font-semibold">{t('notifications.device')}</h2>
      <p className="text-ink-muted">{status()}</p>
      {support === 'ready' && permission !== 'denied' && (
        <>
          {subscribed ? (
            <>
              <Button disabled={offline || test.isPending} onClick={() => test.mutate()}>
                {t('notifications.test')}
              </Button>
              {testMessage()}
              <Button variant="secondary" disabled={offline || busy} onClick={() => disable.mutate()}>
                {t('notifications.disable')}
              </Button>
            </>
          ) : (
            <Button disabled={offline || busy || subscription.isPending} onClick={() => enable.mutate()}>
              {t('notifications.enable')}
            </Button>
          )}
        </>
      )}
      {Boolean(error) && <Message tone="error">{t(errorKey(error))}</Message>}
      <p className="text-sm text-ink-muted">{t('notifications.iphone')}</p>
    </Card>
  )
}

function DailyCard() {
  const { t } = useTranslation()
  const offline = useOffline()
  const { data: profile } = useProfile()
  const update = useUpdateProfile()
  if (!profile) return null

  return (
    <Card>
      <h2 className="font-semibold">{t('notifications.daily')}</h2>
      <p className="text-sm text-ink-muted">{t('notifications.dailyBody')}</p>
      <label className="flex min-h-11 items-center gap-3 font-medium">
        <input
          type="checkbox"
          className="size-5 accent-[var(--brand)]"
          checked={profile.notify_enabled}
          disabled={offline}
          onChange={(event) => update.mutate({ notify_enabled: event.target.checked })}
        />
        {t('notifications.enabled')}
      </label>
      <SelectField
        label={t('notifications.hour')}
        value={profile.notify_hour}
        disabled={offline || !profile.notify_enabled}
        onChange={(event) => update.mutate({ notify_hour: Number(event.target.value) })}
      >
        {hours.map((hour) => (
          <option key={hour} value={hour}>
            {`${String(hour).padStart(2, '0')}:00`}
          </option>
        ))}
      </SelectField>
      <p className="-mt-2 text-sm text-ink-muted">{t('notifications.timezone', { zone: profile.timezone })}</p>
      <Stepper
        label={t('notifications.daysAhead')}
        hint={t('notifications.daysAheadHint')}
        value={profile.notify_days_ahead}
        min={0}
        max={maxDaysAhead}
        onChange={(value) => {
          if (!offline) update.mutate({ notify_days_ahead: value })
        }}
      />
      {update.isError && <Message tone="error">{t('settings.saveError')}</Message>}
    </Card>
  )
}

export function NotificationsPage() {
  const { t } = useTranslation()
  return (
    <Screen
      title={t('notifications.title')}
      backTo="/settings"
      main={
        <div className="flex flex-col gap-4">
          <DeviceCard />
          <DailyCard />
        </div>
      }
    />
  )
}
