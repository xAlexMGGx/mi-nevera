import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { Screen } from '../components/Screen'
import { useShowError } from '../components/Toast'
import { Button, Card, Message } from '../components/ui'
import { useDateContext } from '../data/context'
import { useOffline } from '../lib/connectivity'
import { errorKey } from '../lib/errors'
import { supabase } from '../lib/supabase'

/** En el móvil, Compartir permite guardarlo en Archivos. En el ordenador, se descarga. */
async function saveFile(file: File) {
  if (navigator.maxTouchPoints > 0 && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] })
    return
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function ExportCard() {
  const { t } = useTranslation()
  const { today } = useDateContext()
  const offline = useOffline()
  const showError = useShowError()

  // En dos pasos: el iPhone solo deja compartir justo después de un toque, y preparar el archivo
  // tarda demasiado para que siga contando como el mismo toque.
  const prepare = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('export_my_data')
      if (error) throw error
      return new File([JSON.stringify(data, null, 2)], `nevera-digital-${today}.json`, { type: 'application/json' })
    },
  })

  async function save(file: File) {
    try {
      await saveFile(file)
    } catch (error) {
      if ((error as Error).name !== 'AbortError') showError(error)
    }
  }

  return (
    <Card>
      <h2 className="font-semibold">{t('myData.export.title')}</h2>
      <p className="text-sm text-ink-muted">{t('myData.export.body')}</p>
      {prepare.isError && <Message tone="error">{t(errorKey(prepare.error))}</Message>}
      {prepare.data ? (
        <>
          <Message tone="success">{t('myData.export.ready')}</Message>
          <Button onClick={() => void save(prepare.data)}>{t('myData.export.save')}</Button>
        </>
      ) : (
        <Button variant="secondary" disabled={offline || prepare.isPending} onClick={() => prepare.mutate()}>
          {prepare.isPending ? t('app.loading') : t('myData.export.prepare')}
        </Button>
      )}
    </Card>
  )
}

function DeleteAccountCard() {
  const { t } = useTranslation()
  const offline = useOffline()
  const [confirming, setConfirming] = useState(false)

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('delete_account')
      if (error) throw error
      // Sin sesión, la app vuelve a la pantalla de inicio y borra los datos de este móvil.
      await supabase.auth.signOut({ scope: 'local' })
    },
  })

  return (
    <Card>
      <h2 className="font-semibold">{t('myData.delete.title')}</h2>
      <p className="text-sm text-ink-muted">{t('myData.delete.body')}</p>
      <Button variant="danger" disabled={offline} onClick={() => setConfirming(true)}>
        {t('myData.delete.open')}
      </Button>
      {confirming && (
        <ConfirmSheet
          title={t('myData.delete.sheetTitle')}
          body={t('myData.delete.sheetBody')}
          submit={t('myData.delete.submit')}
          pending={remove.isPending}
          error={remove.error}
          typeToConfirm={{ label: t('myData.delete.type', { word: t('myData.delete.word') }), text: t('myData.delete.word') }}
          onConfirm={() => remove.mutate()}
          onClose={() => setConfirming(false)}
        />
      )}
    </Card>
  )
}

export function MyDataPage() {
  const { t } = useTranslation()
  return (
    <Screen
      title={t('myData.title')}
      backTo="/settings"
      main={
        <div className="flex flex-col gap-4">
          <ExportCard />
          <DeleteAccountCard />
        </div>
      }
    />
  )
}
