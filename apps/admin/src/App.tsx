import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { CallsPage } from './components/CallsPage';
import { ClientsPage } from './components/ClientsPage';
import { CollectionsPage } from './components/CollectionsPage';
import { DashboardPage } from './components/DashboardPage';
import { FieldActivityPage } from './components/FieldActivityPage';
import { FollowUpsPage } from './components/FollowUpsPage';
import { OrdersPage } from './components/OrdersPage';
import { ProductsPage } from './components/ProductsPage';
import { RepresentativesPage } from './components/RepresentativesPage';
import { ReportsPage } from './components/ReportsPage';
import { SignInForm } from './components/SignInForm';
import { UsersPage } from './components/UsersPage';
import { supabase } from './lib/supabase';
import './sidebar-layout.css';

type Page = 'dashboard' | 'clients' | 'representatives' | 'users' | 'fieldActivity' | 'products' | 'orders' | 'collections' | 'followUps' | 'calls' | 'reports';
const labels: Record<Page, string> = { dashboard: 'Sales overview', clients: 'Clients', representatives: 'Sales representatives', users: 'User management', fieldActivity: 'Field activity', products: 'Products', orders: 'Sales orders', collections: 'Collections', followUps: 'Follow-ups', calls: 'Calls & IVR', reports: 'Reports' };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(Boolean(supabase));
  const [page, setPage] = useState<Page>('dashboard');
  async function refreshSession() { if (!supabase) return; const { data } = await supabase.auth.getSession(); setSession(data.session); setLoadingSession(false); }
  useEffect(() => { if (!supabase) return; void refreshSession(); const { data } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setLoadingSession(false); }); return () => data.subscription.unsubscribe(); }, []);
  async function signOut() { if (!supabase) return; await supabase.auth.signOut(); setSession(null); }
  if (!supabase) return <main><h1>Field Sales Platform</h1><p>Configuration required: add the Supabase browser settings.</p></main>;
  if (loadingSession) return <main><h1>Field Sales Platform</h1><p>Checking session…</p></main>;
  if (!session) return <main><h1>Field Sales Platform</h1><p>Sales operations workspace</p><SignInForm client={supabase} onSignedIn={refreshSession} /></main>;
  const content: Record<Page, ReactNode> = { dashboard: <DashboardPage />, clients: <ClientsPage />, representatives: <RepresentativesPage />, users: <UsersPage />, fieldActivity: <FieldActivityPage />, products: <ProductsPage />, orders: <OrdersPage />, collections: <CollectionsPage />, followUps: <FollowUpsPage />, calls: <CallsPage />, reports: <ReportsPage /> };
  const item = (value: Page, text: string, icon: string) => <button className={page === value ? 'active' : ''} onClick={() => setPage(value)}><span>{icon}</span>{text}</button>;
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">FS</span><span>FieldSales<small>OPERATIONS CRM</small></span></div><nav className="side-nav" aria-label="Main navigation"><p className="nav-label">OVERVIEW</p>{item('dashboard', 'Dashboard', '▦')}<p className="nav-label">MANAGE</p>{item('clients', 'Clients', '◎')}{item('representatives', 'Sales representatives', '♙')}{item('users', 'User management', '♧')}<p className="nav-label">SALES OPERATIONS</p>{item('fieldActivity', 'Field activity', '⌖')}{item('products', 'Products', '▣')}{item('orders', 'Sales orders', '₹')}{item('collections', 'Collections', '₹')}{item('followUps', 'Follow-ups', '◷')}{item('calls', 'Calls & IVR', '☎')}{item('reports', 'Reports', '↗')}</nav><div className="sidebar-footer"><span className="online-dot" />Secure organization workspace</div></aside><div className="workspace"><header className="topbar"><div><p className="breadcrumb">FIELD SALES / {labels[page].toUpperCase()}</p><h1>{labels[page]}</h1></div><div className="account"><span>{session.user.email}</span><button onClick={() => void signOut()}>Sign out</button></div></header><main className="content">{content[page]}</main></div></div>;
}
