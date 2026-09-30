import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { StoreProvider } from './store/Store';
import { LandingPage } from './pages/Landing';
import { LoginPage, SignupPage } from './pages/Auth';
import { DashboardPage } from './pages/Dashboard';
import { BinderPage } from './pages/Binder';
import { PlanPage } from './pages/Plan';
import { CollectionPage } from './pages/Collection';
import { ScanPage } from './pages/Scan';
import { SharePage } from './pages/Share';
import { BinderUnavailablePage, SharedBinderPage } from './pages/SharedBinder';
import { ShareSync } from './components/ShareSync';
import { ValueHistorySync } from './components/ValueHistorySync';
import { AccountPage } from './pages/Account';
import { PremiumPage } from './pages/Premium';

import { ThemeProvider } from './theme/Theme';

export default function App() {
  return (
    <ThemeProvider>
      <StoreProvider>
        <ShareSync />
        <ValueHistorySync />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/binder/:id" element={<BinderPage />} />
            <Route path="/plan" element={<PlanPage />} />
            <Route path="/collection" element={<CollectionPage />} />
            <Route path="/scan" element={<ScanPage />} />
            <Route path="/share" element={<SharePage />} />
            <Route path="/premium" element={<PremiumPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/s/:token" element={<SharedBinderPage />} />
            {/* Old profile-wide links: no longer a way to browse someone's binders */}
            <Route path="/u/*" element={<BinderUnavailablePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </StoreProvider>
    </ThemeProvider>
  );
}
