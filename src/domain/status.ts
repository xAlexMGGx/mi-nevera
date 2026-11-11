// La regla vive en supabase/functions/_shared para que la notificación diaria use exactamente la misma.
export {
  mostUrgent,
  severity,
  statusOf,
  type DatedItem,
  type RowDate,
  type Status,
} from '../../supabase/functions/_shared/dateStatus.ts'
