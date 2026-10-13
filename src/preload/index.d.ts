import type { MailmanApi } from '../shared/types'

declare global {
  interface Window {
    mailman: MailmanApi
  }
}
