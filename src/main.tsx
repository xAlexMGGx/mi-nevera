import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { App } from './App'
import { AuthProvider } from './auth/AuthProvider'
import { ToastProvider } from './components/Toast'
import { SessionCache } from './data/cache'
import './i18n'
import './index.css'
import { isSupabaseConfigured } from './lib/supabase'
import { ConfigMissingPage } from './pages/ConfigMissingPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSupabaseConfigured ? (
      <AuthProvider>
        <SessionCache>
          <ToastProvider>
            <HashRouter>
              <App />
            </HashRouter>
          </ToastProvider>
        </SessionCache>
      </AuthProvider>
    ) : (
      <ConfigMissingPage />
    )}
  </StrictMode>,
)
