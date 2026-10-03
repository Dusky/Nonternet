import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Me } from '@app/shared';
import { useIsDesktop, useMe, useSite, useT } from './hooks';
import { PageNav } from './nav';
import { APPS, type AppDef } from './shell/apps';
import { Desktop } from './shell/Desktop';
import { Launcher } from './shell/Launcher';
import { Shell } from './shell/Shell';
import { applyTheme } from './theme';
import { Centered, Loading } from './components/ui';
import { AnnouncementBanner } from './components/Announcements';
import { LoginPage } from './pages/Login';
import { AppBoundary } from './components/Boundary';
import { Landing } from './pages/Landing';

// The front door (Landing, Login) loads with the page; the rest are fetched when someone goes there, so a visitor's first load stays small.
const SignupPage = lazy(() => import('./pages/Signup').then((m) => ({ default: m.SignupPage })));
const LegalPageRoute = lazy(() => import('./pages/Legal').then((m) => ({ default: m.LegalPageRoute })));
const ForgotPasswordPage = lazy(() => import('./pages/Recovery').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/Recovery').then((m) => ({ default: m.ResetPasswordPage })));
const VerifyEmailPage = lazy(() => import('./pages/Recovery').then((m) => ({ default: m.VerifyEmailPage })));
const ConfirmEmailPage = lazy(() => import('./pages/Recovery').then((m) => ({ default: m.ConfirmEmailPage })));
const Setup2faPage = lazy(() => import('./pages/Setup2fa').then((m) => ({ default: m.Setup2faPage })));
const ReportHomepagePage = lazy(() => import('./pages/ReportHomepage').then((m) => ({ default: m.ReportHomepagePage })));
const GuestbookSignPage = lazy(() => import('./pages/GuestbookSign').then((m) => ({ default: m.GuestbookSignPage })));

// Sends anyone who is not signed in to the login page, and back here afterwards. An admin who
// has not set up two-factor is held at that step (the server refuses their other calls anyway).
function RequireUser({ children, allowLimited = false }: { children: (me: Me) => ReactNode; allowLimited?: boolean }) {
  const me = useMe();
  const location = useLocation();
  if (me.isLoading) return null;
  if (!me.data) return <Navigate to={`/login?return_to=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (me.data.limited && !allowLimited) return <Navigate to="/setup-2fa" replace />;
  return <>{children(me.data)}</>;
}

function Home() {
  const me = useMe();
  const desktop = useIsDesktop();
  if (me.isLoading) return null;
  if (!me.data) return <Landing />;
  if (me.data.limited) return <Navigate to="/setup-2fa" replace />;
  return <Shell me={me.data}>{desktop ? <Desktop me={me.data} /> : <Launcher me={me.data} />}</Shell>;
}

// An app on its own page: the address every app has (docs/10), and how apps open on a phone.
function AppPage({ app, me }: { app: AppDef; me: Me }) {
  const t = useT();
  return (
    <Shell me={me}>
      <section className="app-page" aria-labelledby="app-title">
        <h1 id="app-title">{t(app.title)}</h1>
        <PageNav base={app.path} id={app.id}>
          <AppBoundary><Suspense fallback={<Loading />}><app.Component /></Suspense></AppBoundary>
        </PageNav>
      </section>
    </Shell>
  );
}

// What a visitor who is not signed in sees around a public app such as the boards: the same page,
// with a way in instead of the account menu.
function PublicFrame({ app }: { app: AppDef }) {
  const t = useT();
  const site = useSite();
  const location = useLocation();
  const back = encodeURIComponent(location.pathname + location.search);
  return (
    <div className="shell">
      <a className="skip" href="#main">{t('nav.skip')}</a>
      <header className="taskbar">
        <Link className="brand" to="/"><span className="brand-mark" aria-hidden="true" />{t('landing.title')}</Link>
        <span className="taskbar-account">
          <Link className="btn btn-quiet" to={`/login?return_to=${back}`}>{t('auth.login')}</Link>
          {site.signup_mode !== 'application' && <Link className="btn btn-primary" to="/signup">{t('auth.signup')}</Link>}
        </span>
      </header>
      <AnnouncementBanner />
      <main className="stage" id="main">
        <section className="app-page" aria-labelledby="app-title">
          <h1 id="app-title">{t(app.title)}</h1>
          <PageNav base={app.path} id={app.id}>
            <AppBoundary><Suspense fallback={<Loading />}><app.Component /></Suspense></AppBoundary>
          </PageNav>
        </section>
      </main>
    </div>
  );
}

// Public apps open for everyone; the rest need an account.
function AppRoute({ app }: { app: AppDef }) {
  const me = useMe();
  if (app.public) {
    if (me.isLoading) return null;
    if (!me.data || me.data.limited) return <PublicFrame app={app} />;
    return <AppPage app={app} me={me.data} />;
  }
  return <RequireUser>{(user) => <AppPage app={app} me={user} />}</RequireUser>;
}

function Setup2faRoute() {
  const navigate = useNavigate();
  return <RequireUser allowLimited>{() => <Setup2faPage onDone={() => navigate('/', { replace: true })} />}</RequireUser>;
}

function NotFound() {
  const t = useT();
  return <Centered title={t('error.notFound')}><p className="links"><Link to="/">{t('nav.home')}</Link></p></Centered>;
}

export function App() {
  const me = useMe();
  // The theme saved on the profile wins once we know who is signed in.
  useEffect(() => { if (me.data?.theme) applyTheme(me.data.theme, { scheme: me.data.theme_variant }); }, [me.data?.theme, me.data?.theme_variant]);
  return (
    <Suspense fallback={<Loading />}>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/legal/:slug" element={<LegalPageRoute />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/confirm-email" element={<ConfirmEmailPage />} />
      <Route path="/setup-2fa" element={<Setup2faRoute />} />
      <Route path="/guestbook-sign" element={<RequireUser>{() => <GuestbookSignPage />}</RequireUser>} />
      <Route path="/report/homepage/:handle" element={<RequireUser>{() => <ReportHomepagePage />}</RequireUser>} />
      {APPS.map((app) => <Route key={app.id} path={`${app.path}/*`} element={<AppRoute app={app} />} />)}
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  );
}
