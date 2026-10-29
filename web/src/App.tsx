import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Role } from './api';
import { Spinner } from './components/ui';
import { AuthProvider, homeFor, useAuth } from './lib/auth';
import { ToastProvider } from './lib/toast';

// Every page is its own chunk so a provider on 3G only downloads what they open.
const Login = lazy(() => import('./pages/Login'));
const BecomeProvider = lazy(() => import('./pages/BecomeProvider'));

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const AdminBookings = lazy(() => import('./pages/admin/Bookings'));
const AdminProviders = lazy(() => import('./pages/admin/Providers'));
const AdminBadges = lazy(() => import('./pages/admin/Badges'));
const AdminPricing = lazy(() => import('./pages/admin/Pricing'));
const AdminCommission = lazy(() => import('./pages/admin/Commission'));
const AdminPayments = lazy(() => import('./pages/admin/Payments'));
const AdminPayouts = lazy(() => import('./pages/admin/Payouts'));
const AdminCatalog = lazy(() => import('./pages/admin/Catalog'));
const AdminZones = lazy(() => import('./pages/admin/Zones'));
const AdminSettings = lazy(() => import('./pages/admin/Settings'));
const AdminSms = lazy(() => import('./pages/admin/SmsOutbox'));
const AdminAudit = lazy(() => import('./pages/admin/AuditLog'));

const ProviderLayout = lazy(() => import('./pages/provider/ProviderLayout'));
const ProviderOverview = lazy(() => import('./pages/provider/Overview'));
const ProviderJobs = lazy(() => import('./pages/provider/Jobs'));
const ProviderTeam = lazy(() => import('./pages/provider/Team'));
const ProviderServices = lazy(() => import('./pages/provider/ServicesZones'));
const ProviderBadges = lazy(() => import('./pages/provider/Badges'));
const ProviderWallet = lazy(() => import('./pages/provider/Wallet'));
const ProviderPlans = lazy(() => import('./pages/provider/Plans'));

function RequireRole({ role, children }: { role: Role | Role[]; children: ReactNode }) {
  const { session } = useAuth();
  const loc = useLocation();
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  const roles = Array.isArray(role) ? role : [role];
  if (!roles.includes(session.user.role)) return <Navigate to={homeFor(session.user.role)} replace />;
  return <>{children}</>;
}

function Home() {
  const { session } = useAuth();
  return <Navigate to={session ? homeFor(session.user.role) : '/login'} replace />;
}

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route
                path="/become-provider"
                element={
                  <RequireRole role="customer">
                    <BecomeProvider />
                  </RequireRole>
                }
              />
              <Route
                path="/admin"
                element={
                  <RequireRole role="admin">
                    <AdminLayout />
                  </RequireRole>
                }
              >
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<AdminDashboard />} />
                <Route path="bookings" element={<AdminBookings />} />
                <Route path="providers" element={<AdminProviders />} />
                <Route path="badges" element={<AdminBadges />} />
                <Route path="pricing" element={<AdminPricing />} />
                <Route path="commission" element={<AdminCommission />} />
                <Route path="payments" element={<AdminPayments />} />
                <Route path="payouts" element={<AdminPayouts />} />
                <Route path="catalog" element={<AdminCatalog />} />
                <Route path="zones" element={<AdminZones />} />
                <Route path="settings" element={<AdminSettings />} />
                <Route path="sms" element={<AdminSms />} />
                <Route path="audit" element={<AdminAudit />} />
                <Route path="*" element={<Navigate to="dashboard" replace />} />
              </Route>
              <Route
                path="/provider"
                element={
                  <RequireRole role="provider">
                    <ProviderLayout />
                  </RequireRole>
                }
              >
                <Route index element={<Navigate to="overview" replace />} />
                <Route path="overview" element={<ProviderOverview />} />
                <Route path="jobs" element={<ProviderJobs />} />
                <Route path="team" element={<ProviderTeam />} />
                <Route path="services" element={<ProviderServices />} />
                <Route path="badges" element={<ProviderBadges />} />
                <Route path="wallet" element={<ProviderWallet />} />
                <Route path="plans" element={<ProviderPlans />} />
                <Route path="*" element={<Navigate to="overview" replace />} />
              </Route>
              <Route path="*" element={<Home />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
