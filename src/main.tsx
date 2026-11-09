import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { App } from './App'
import { AuthProvider } from './auth/AuthProvider'
import './i18n'
import './index.css'
import { isSupabaseConfigured } from './lib/supabase'
import { ConfigMissingPage } from './pages/ConfigMissingPage'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSupabaseConfigured ? (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <HashRouter>
            <App />
          </HashRouter>
        </AuthProvider>
      </QueryClientProvider>
    ) : (
      <ConfigMissingPage />
    )}
  </StrictMode>,
)
