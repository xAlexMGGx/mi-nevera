import { Navigate, Route, Routes, useParams } from 'react-router'
import { useAuth } from './auth/AuthProvider'
import { RequireHouse, TabsLayout } from './components/AppShell'
import { BootLoader } from './components/ui'
import { rememberInvite } from './lib/pendingInvite'
import { AddLeftoverPage } from './pages/AddLeftoverPage'
import { AddPage } from './pages/AddPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { HousePage } from './pages/HousePage'
import { HousesPage } from './pages/HousesPage'
import { InventoryPage } from './pages/InventoryPage'
import { JoinPage } from './pages/JoinPage'
import { LoginPage } from './pages/LoginPage'
import { MovementsPage } from './pages/MovementsPage'
import { MyDataPage } from './pages/MyDataPage'
import { ProductPage } from './pages/ProductPage'
import { RegisterPage } from './pages/RegisterPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { SettingsPage } from './pages/SettingsPage'

/** Enlace de invitación sin haber entrado: se recuerda para después de iniciar sesión. */
function RememberInviteAndLogin() {
  const { code } = useParams()
  if (code) rememberInvite(code)
  return <Navigate to="/login" replace />
}

export function App() {
  const { session, loading, recovering } = useAuth()

  if (loading) return <BootLoader />
  if (recovering && session) return <ResetPasswordPage />

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/join/:code" element={<RememberInviteAndLogin />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/join/:code?" element={<JoinPage />} />
      <Route element={<RequireHouse />}>
        <Route element={<TabsLayout />}>
          <Route index element={<InventoryPage />} />
        </Route>
        <Route path="/add" element={<AddPage />} />
        <Route path="/add/leftover" element={<AddLeftoverPage />} />
        <Route path="/product/:id" element={<ProductPage />} />
        <Route path="/movements" element={<MovementsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/houses" element={<HousesPage />} />
        <Route path="/houses/:id" element={<HousePage />} />
        <Route path="/my-data" element={<MyDataPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
