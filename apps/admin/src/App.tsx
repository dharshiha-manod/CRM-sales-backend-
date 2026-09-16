import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useCurrentMembership } from './auth/useCurrentMembership';
import { CallsPage } from './components/CallsPage';
import { IncomingCallPopup } from './components/IncomingCallPopup'; // NEW
import { ClientsPage } from './components/ClientsPage';
import { CollectionsPage } from './components/CollectionsPage';
import { DashboardPage } from './components/DashboardPage';
import { FieldActivityPage } from './components/FieldActivityPage';
import { FollowUpsPage } from './components/FollowUpsPage';
import { LeadsPage } from './components/leadpage';
import { OrdersPage } from './components/OrdersPage';
import { ProductsPage } from './components/ProductsPage';
import { BrandsCategoriesPage } from './components/BrandsCategoriesPage';
import { QuotationsPage } from './components/QuotationsPage';
import { TargetsPage } from './components/TargetsPage';
import { InventoryPage } from './components/InventoryPage';
import { RequirementsPage } from './components/RequirementsPage';
import { RepresentativesPage } from './components/RepresentativesPage';
import { RouteBeatPage } from './components/RouteBeatPage';
import { SchemeDiscountPage } from './components/SchemeDiscountPage';
import { DistributorPage } from './components/DistributorPage';
import { SchoolManagementPage } from './components/SchoolManagementPage';
import { SchoolSalesCollectionPage } from './components/SchoolSalesCollectionPage';
import { AcademicYearTermPage } from './components/AcademicYearTermPage';
import { SpecificPricingDiscountPage } from './components/SpecificPricingDiscountPage'; 
import { SalesReturnDamagePage } from './components/SalesReturnDamagePage';
import { BatchExpiryPage } from './components/BatchExpiryPage';
import { DesignPatternPage } from './components/DesignPatternPage';
import { ColourSizePage } from './components/ColourSizePage';
import { FabricRollPage } from './components/FabricRollPage';
import { TextileSamplePage } from './components/TextileSamplePage';
import { QualityInspectionPage } from './components/QualityInspectionPage';
import { PharmaSamplePage } from './components/PharmaSamplePage';
import { PharmaBatchExpiryPage } from './components/PharmaBatchExpiryPage';
import { PharmaProductPromotionPage } from './components/PharmaProductPromotionPage';
import { PharmaHospitalEngagementPage } from './components/PharmaHospitalEngagementPage';
import { PharmaMedicineReturnPage } from './components/PharmaMedicineReturnPage';
import { PharmaRecallPage } from './components/PharmaRecallPage';
import { TradingDealPage } from './components/TradingDealPage';
import { TradingSupplierVendorPage } from './components/TradingSupplierVendorPage';
import { TradingPurchaseEnquiryPage } from './components/TradingPurchaseEnquiryPage';
import { TradingPriceRateListPage } from './components/TradingPriceRateListPage';
import { TradingShipmentPage } from './components/TradingShipmentPage';
import { TradeDocumentsPage } from './components/TradeDocumentsPage';
import { CurrencyManagementPage } from './components/CurrencyManagementPage';
import { LogisticsPage } from './components/LogisticsPage';
import { ImportExportPage } from './components/ImportExportPage';
import { CustomsClearancePage } from './components/CustomsClearancePage';
import { ClaimsDisputesPage } from './components/ClaimsDisputesPage';
import { CommissionManagementPage } from './components/CommissionManagementPage';
import { TradeProfitabilityPage } from './components/TradeProfitabilityPage';
import { TradeCompliancePage } from './components/TradeCompliancePage';
import { TradeFinanceLCPage } from './components/TradeFinanceLCPage';
import { VehicleDealerPage } from './components/VehicleDealerPage';
import { VehicleCatalogPage } from './components/VehicleCatalogPage';
import { VehicleTestDrivePage } from './components/VehicleTestDrivePage';
import { VehicleBookingPage } from './components/VehicleBookingPage';
import { VehicleSchemeDiscountPage } from './components/VehicleSchemeDiscountPage';
import { VehicleDeliveryPdiPage } from './components/VehicleDeliveryPdiPage';
import { VehicleRegistrationPage } from './components/VehicleRegistrationPage';
import { VehicleFinanceLoanPage } from './components/VehicleFinanceLoanPage';
import { VehicleInsurancePage } from './components/VehicleInsurancePage';
import { VehicleExchangePage } from './components/VehicleExchangePage';
import { VehicleWarrantyPage } from './components/VehicleWarrantyPage';
import { VehicleServicePage } from './components/VehicleServicePage';
import { VehicleReturnsPage } from './components/VehicleReturnsPage';
import { ReportsPage } from './components/ReportsPage';
import { SignInForm } from './components/SignInForm';
import { UsersPage } from './components/UsersPage';
import { SettingsPage } from './components/SettingsPage';
import { NotificationsPage } from './components/NotificationsPage';
import { GpsTrackingPage } from './components/GpsTrackingPage';
import { supabase } from './lib/supabase';
import { INDUSTRY_MODULES } from './industry/moduleDefs';
import type { ModuleDef } from './industry/moduleDefs';
import { IndustryModulePage } from './industry/IndustryModulePage';
import { INDUSTRY_CONFIGS } from './industry/mockData';
import type { IndustryKey } from './industry/types';
import { useIndustry, INDUSTRY_ORDER } from './industry/IndustryContext';
import './sidebar-layout.css';
type Page = 'dashboard' | 'clients' | 'representatives' | 'users' | 'leads' | 'fieldActivity' | 'products' | 'brandsCategories' | 'requirements' | 'quotations' | 'orders' | 'collections' | 'followUps' | 'calls' | 'reports' | 'target' | 'inventory' | 'gpsTracking' | 'settings' | 'notifications' | `industry:${string}`;
const labels: Record<string, string> = { dashboard: 'Sales overview', clients: 'Clients', representatives: 'Sales representatives', users: 'User management', leads: 'Leads', fieldActivity: 'Field activity', products: 'Products', requirements: 'Requirements', quotations: 'Quotations', orders: 'Sales orders', collections: 'Collections', followUps: 'Follow-ups', calls: 'Calls & IVR', reports: 'Reports', target: 'Target', inventory: 'Inventory', gpsTracking: 'GPS Verified Tracking', settings: 'Settings', notifications: 'Notification' };

function moduleLabel(key: IndustryKey, moduleId: string): string {
  const mod = INDUSTRY_MODULES[key].find((m) => m.id === moduleId);
  return mod ? mod.label : 'Industry module';
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(Boolean(supabase));
   const validPages: string[] = ['dashboard', 'clients', 'representatives', 'users', 'leads', 'fieldActivity', 'products', 'brandsCategories', 'requirements', 'quotations', 'orders', 'collections', 'followUps', 'calls', 'reports', 'target', 'inventory', 'gpsTracking', 'settings', 'notifications'];
  const pageFromHash = (): Page => {
    const hash = window.location.hash.replace('#', '');
    if (hash.startsWith('industry:')) return hash as Page;
    return validPages.includes(hash) ? (hash as Page) : 'dashboard';
  };
  const [page, setPage] = useState<Page>(pageFromHash());
 const { activeIndustry, setActiveIndustry, canSwitchIndustry } = useIndustry();
const { isGlobal } = useCurrentMembership();
  async function refreshSession() { if (!supabase) return; const { data } = await supabase.auth.getSession(); setSession(data.session); setLoadingSession(false); }
  useEffect(() => { if (!supabase) return; void refreshSession(); const { data } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setLoadingSession(false); }); return () => data.subscription.unsubscribe(); }, []);
  useEffect(() => { window.location.hash = page; }, [page]);
  useEffect(() => { const onHashChange = () => setPage(pageFromHash()); window.addEventListener('hashchange', onHashChange); return () => window.removeEventListener('hashchange', onHashChange); }, []);
  async function signOut() { if (!supabase) return; await supabase.auth.signOut(); setSession(null); }
  if (!supabase) return <main><h1>Field Sales Platform</h1><p>Configuration required: add the Supabase browser settings.</p></main>;
  if (loadingSession) return <main><h1>Field Sales Platform</h1><p>Checking session…</p></main>;
  if (!session) return <main><h1>Field Sales Platform</h1><p>Sales operations workspace</p><SignInForm client={supabase} onSignedIn={refreshSession} /></main>;
     const content: Record<string, ReactNode> = { dashboard: <DashboardPage />, clients: <ClientsPage />, representatives: <RepresentativesPage />, users: <UsersPage />, leads: <LeadsPage />, fieldActivity: <FieldActivityPage />, products: <ProductsPage />, brandsCategories: <BrandsCategoriesPage />, requirements: <RequirementsPage />, quotations: <QuotationsPage />, orders: <OrdersPage />, collections: <CollectionsPage />, followUps: <FollowUpsPage />, calls: <CallsPage />, reports: <ReportsPage />, target: <TargetsPage />, inventory: <InventoryPage />, gpsTracking: <GpsTrackingPage />, settings: <SettingsPage />, notifications: <NotificationsPage onNavigate={(target) => setPage(target as Page)} /> };
  INDUSTRY_ORDER.forEach((key) => {
    INDUSTRY_MODULES[key].forEach((mod: ModuleDef) => {
      content[`industry:${key}:${mod.id}`] = <IndustryModulePage industryLabel={INDUSTRY_CONFIGS[key].label} module={mod} />;
    });
  });
  content['industry:fmcg:route-beat'] = <RouteBeatPage />;
  content['industry:fmcg:scheme-discount'] = <SchemeDiscountPage />;
   content['industry:fmcg:distributor'] = <DistributorPage />;
  content['industry:fmcg:sales-return-damage'] = <SalesReturnDamagePage />;
  content['industry:fmcg:batch-expiry'] = <BatchExpiryPage />;
content['industry:school:school-management'] = <SchoolManagementPage />;
    content['industry:school:school-sales-collection'] = <SchoolSalesCollectionPage />;
  content['industry:school:academic-year-term'] = <AcademicYearTermPage />;
  content['industry:school:specific-pricing-discount'] = <SpecificPricingDiscountPage />;
  content['industry:textile:design-pattern'] = <DesignPatternPage />;
  content['industry:textile:colour-size'] = <ColourSizePage />;
  content['industry:textile:fabric-roll'] = <FabricRollPage />;
  content['industry:textile:textile-sample'] = <TextileSamplePage />;
  content['industry:textile:quality-inspection'] = <QualityInspectionPage />;
  content['industry:textile:distributor'] = <DistributorPage industryLabel="Textile" />;
  content['industry:pharma:sample'] = <PharmaSamplePage />;
  content['industry:pharma:batch-expiry'] = <PharmaBatchExpiryPage />;
  content['industry:pharma:product-promotion'] = <PharmaProductPromotionPage />;
  content['industry:pharma:hospital-engagement'] = <PharmaHospitalEngagementPage />;
  content['industry:pharma:medicine-return'] = <PharmaMedicineReturnPage />;
  content['industry:pharma:recall'] = <PharmaRecallPage />;
  content['industry:trading:deal'] = <TradingDealPage />;
  content['industry:trading:supplier-vendor'] = <TradingSupplierVendorPage />;
  content['industry:trading:purchase-enquiry'] = <TradingPurchaseEnquiryPage />;
  content['industry:trading:price-rate-list'] = <TradingPriceRateListPage />;
  content['industry:trading:shipment'] = <TradingShipmentPage />;
  content['industry:trading:trade-documents'] = <TradeDocumentsPage />;
  content['industry:trading:currency'] = <CurrencyManagementPage />;
  content['industry:trading:logistics'] = <LogisticsPage />;
  content['industry:trading:import-export'] = <ImportExportPage />;
  content['industry:trading:customs-clearance'] = <CustomsClearancePage />;
  content['industry:trading:claims-disputes'] = <ClaimsDisputesPage />;
  content['industry:trading:commission'] = <CommissionManagementPage />;
  content['industry:trading:trade-profitability'] = <TradeProfitabilityPage />;
  content['industry:trading:trade-compliance'] = <TradeCompliancePage />;
content['industry:trading:trade-finance-lc'] = <TradeFinanceLCPage />;
  content['industry:vehicle:dealers'] = <VehicleDealerPage />;
  content['industry:vehicle:catalog'] = <VehicleCatalogPage />;
  content['industry:vehicle:test-drive'] = <VehicleTestDrivePage />;
  content['industry:vehicle:booking'] = <VehicleBookingPage />;
  content['industry:vehicle:schemes'] = <VehicleSchemeDiscountPage />;
  content['industry:vehicle:delivery-pdi'] = <VehicleDeliveryPdiPage />;
  content['industry:vehicle:registration'] = <VehicleRegistrationPage />;
  content['industry:vehicle:finance'] = <VehicleFinanceLoanPage />;
  content['industry:vehicle:insurance'] = <VehicleInsurancePage />;
  content['industry:vehicle:exchange'] = <VehicleExchangePage />;
  content['industry:vehicle:warranty'] = <VehicleWarrantyPage />;
  content['industry:vehicle:service'] = <VehicleServicePage />;
  content['industry:vehicle:returns'] = <VehicleReturnsPage />;
  const item = (value: Page, text: string, icon: string) => (
    <button key={value} className={page === value ? 'active' : ''} onClick={() => setPage(value)} title={text}>
      <span>{icon}</span>
      <span className="nav-label-text">{text}</span>
    </button>
  );

  const pageLabel = page.startsWith('industry:')
    ? moduleLabel(activeIndustry, page.split(':')[2])
    : (labels[page] ?? 'Dashboard');

  return (
    <div className="app-shell">
      <IncomingCallPopup />{/* NEW — global, shows on any page when a call rings in */}
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">SC</span><span>Sales CRM<small>FIELD OPERATIONS</small></span></div>
        <nav className="side-nav" aria-label="Main navigation">
          <p className="nav-label">OVERVIEW</p>{item('dashboard', 'Dashboard', '▦')}{item('reports', 'Reports', '↗')}
          <p className="nav-label">PIPELINE</p>{item('leads', 'Leads', '✦')}{item('clients', 'Clients', '◎')}{item('requirements', 'Requirements', '⚑')}{item('quotations', 'Quotations', '≡')}
          <p className="nav-label">SALES OPERATIONS</p>{item('orders', 'Sales orders', '₹')}{item('collections', 'Collections', '₹')}{item('followUps', 'Follow-ups', '◷')}{item('fieldActivity', 'Field activity', '⌖')}{item('gpsTracking', 'GPS Verified Tracking', '⦿')}
                  <p className="nav-label">PRODUCT &amp; INVENTORY</p>{item('products', 'Products', '▣')}{item('brandsCategories', 'Brands & Categories', '◆')}{item('inventory', 'Inventory', '▤')}
          <p className="nav-label">TEAM &amp; PERFORMANCE</p>{item('target', 'Target', '◎')}{item('representatives', 'Sales representatives', '♙')}
          <p className="nav-label">ADMINISTRATION</p>{item('users', 'User management', '♧')}{item('settings', 'Settings', '⚙')}{item('notifications', 'Notification', '⚑')}{item('calls', 'Calls & IVR', '☎')}
          <p className="nav-label">INDUSTRY TYPE</p>
          <select
            className="industry-select"
            value={activeIndustry}
            onChange={(e) => {
              const key = e.target.value as IndustryKey;
              setActiveIndustry(key);
              setPage(`industry:${key}:${INDUSTRY_MODULES[key][0].id}` as Page);
            }}
          >
            {INDUSTRY_ORDER.map((key) => <option key={key} value={key}>{INDUSTRY_CONFIGS[key].label}</option>)}
          </select>
          <p className="nav-label">{INDUSTRY_CONFIGS[activeIndustry].label.toUpperCase()} MODULES</p>
          {INDUSTRY_MODULES[activeIndustry].map((mod) => item(`industry:${activeIndustry}:${mod.id}` as Page, mod.label, mod.icon))}
        </nav>
        <div className="sidebar-footer"><span className="online-dot" />Secure organization workspace</div>
      </aside>
         <div className="workspace">
        <header className="topbar">
                    <span className="active-industry-badge" data-industry={activeIndustry}>{INDUSTRY_CONFIGS[activeIndustry].label}</span>
               <div className="account">
            <span>{session.user.email}</span>
            <button onClick={() => void signOut()}>Sign out</button>
          </div>
        </header>
        <main className="content">{content[page]}</main>
      </div>
    </div>
  );
}