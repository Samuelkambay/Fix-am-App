import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useAuth } from './lib/auth';
import Home from './pages/Home';

const Category = lazy(() => import('./pages/Category'));
const ServicePage = lazy(() => import('./pages/Service'));
const Checkout = lazy(() => import('./pages/Checkout'));
const Bookings = lazy(() => import('./pages/Bookings'));
const BookingDetail = lazy(() => import('./pages/BookingDetail'));
const Wallet = lazy(() => import('./pages/Wallet'));
const Verify = lazy(() => import('./pages/Verify'));
const Login = lazy(() => import('./pages/Login'));
const Profile = lazy(() => import('./pages/Profile'));
const Provider = lazy(() => import('./pages/Provider'));
const Search = lazy(() => import('./pages/Search'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="*" element={<Lazy />} />
      </Route>
    </Routes>
  );
}

function Lazy() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/search" element={<Search />} />
        <Route path="/category/:id" element={<Category />} />
        <Route path="/service/:id" element={<ServicePage />} />
        <Route path="/providers/:id" element={<Provider />} />
        <Route path="/checkout" element={<RequireAuth><Checkout /></RequireAuth>} />
        <Route path="/bookings" element={<RequireAuth><Bookings /></RequireAuth>} />
        <Route path="/bookings/:id" element={<RequireAuth><BookingDetail /></RequireAuth>} />
        <Route path="/wallet" element={<RequireAuth><Wallet /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/verify/:code" element={<Verify />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
