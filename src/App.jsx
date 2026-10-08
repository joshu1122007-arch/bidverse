import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ProtectedRoute from './components/ProtectedRoute';
import StatePanel from './components/StatePanel';
import Home from './pages/Home';
import './App.css';

const Explore = lazy(() => import('./pages/Explore'));
const AuctionDetails = lazy(() => import('./pages/AuctionDetails'));
const CreateAuction = lazy(() => import('./pages/CreateAuction'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Login = lazy(() => import('./pages/Login'));

export default function App() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return <><a className="skip-link" href="#main-content">Skip to content</a><Navbar /><main id="main-content" tabIndex={-1}><Suspense fallback={<div className="container page-shell"><StatePanel loading title="Opening your next discovery…" /></div>}><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/explore" element={<Explore />} />
    <Route path="/auctions/:id" element={<AuctionDetails />} />
    <Route path="/create" element={<ProtectedRoute><CreateAuction /></ProtectedRoute>} />
    <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
    <Route path="/login" element={<Login />} />
    <Route path="*" element={<div className="container page-shell"><StatePanel title="This find got away" message="We couldn’t find that page. There’s plenty more to discover."><Link to="/explore" className="button button-primary">Explore auctions</Link></StatePanel></div>} />
  </Routes></Suspense></main><Footer /></>;
}
