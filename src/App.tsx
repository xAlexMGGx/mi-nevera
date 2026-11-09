import { Navigate, Route, Routes } from 'react-router'
import { useAuth } from './auth/AuthProvider'
import { RequireHouse, TabsLayout } from './components/AppShell'
import { FullScreenLoader } from './components/ui'
import { AddLeftoverPage } from './pages/AddLeftoverPage'
import { AddPage } from './pages/AddPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { InventoryPage } from './pages/InventoryPage'
import { LoginPage } from './pages/LoginPage'
import { MovementsPage } from './pages/MovementsPage'
import { ProductPage } from './pages/ProductPage'
import { RegisterPage } from './pages/RegisterPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { SettingsPage } from './pages/SettingsPage'

export function App() {
  const { session, loading, recovering } = useAuth()

  if (loading) return <FullScreenLoader />
  if (recovering && session) return <ResetPasswordPage />

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route element={<RequireHouse />}>
        <Route element={<TabsLayout />}>
          <Route index element={<InventoryPage />} />
        </Route>
        <Route path="/add" element={<AddPage />} />
        <Route path="/add/leftover" element={<AddLeftoverPage />} />
        <Route path="/product/:id" element={<ProductPage />} />
        <Route path="/movements" element={<MovementsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
