import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Search, SlidersHorizontal } from 'lucide-react';
import AuctionCard from '../components/AuctionCard';
import StatePanel from '../components/StatePanel';
import { supabase, isConfigured } from '../lib/supabase';
import { categories, filterAuctions } from '../lib/format';
import { fetchAll } from '../lib/fetchAll';
import { sampleAuctions } from '../data/sampleAuctions';

export default function Explore() {
  const [params, setParams] = useSearchParams();
  const [auctions, setAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [sort, setSort] = useState('ending-soon');
  const [now, setNow] = useState(Date.now);
  const category = params.get('category') || 'All';

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    async function load() {
      if (!active || inFlight) return;
      inFlight = true;
      if (!isConfigured) {
        setAuctions(sampleAuctions);
        setLoading(false);
        inFlight = false;
        return;
      }
      try {
        const data = await fetchAll(supabase.from('auction_summaries').select('*').order('created_at', { ascending: false }).order('id', { ascending: true }));
        if (active) { setAuctions(data); setError(''); }
      } catch (fetchError) {
        if (active) setError(fetchError.message || 'Auctions could not be loaded. Please try again.');
      } finally {
        inFlight = false;
        if (active) setLoading(false);
      }
    }
    load();
    const interval = isConfigured ? setInterval(load, 15000) : null;
    return () => { active = false; clearInterval(interval); };
  }, [retry]);

  const filtered = filterAuctions(auctions, { search, category, status, sort }, now);

  function changeCategory(value) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (value === 'All') next.delete('category');
      else next.set('category', value);
      return next;
    });
  }

  function clearFilters() {
    setSearch('');
    setStatus('active');
    setSort('ending-soon');
    changeCategory('All');
  }

  return (
    <div className="container page-shell explore-page">
      <header className="page-heading">
        <p className="eyebrow">THE MARKETPLACE</p>
        <h1>Your next great find <span>starts here.</span></h1>
        <p className="muted">Discover one-of-a-kind pieces. Find your favorite. Make your move.</p>
      </header>

      {!isConfigured && <div className="config-banner"><div><strong>A little preview of what’s possible.</strong><p>These are sample listings. Connect Supabase using the setup guide in README to create auctions and place real bids.</p></div><ArrowUpRight size={22} aria-hidden="true" /></div>}

      <div className="filter-bar">
        <div className="search-field"><Search size={19} aria-hidden="true" /><label className="sr-only" htmlFor="auction-search">Search auctions</label><input id="auction-search" type="search" placeholder="Search for your next find…" value={search} onChange={event => setSearch(event.target.value)} /></div>
        <div className="filter-controls">
          <SlidersHorizontal size={17} aria-hidden="true" />
          <label className="sr-only" htmlFor="auction-category">Category</label>
          <select id="auction-category" value={category} onChange={event => changeCategory(event.target.value)}><option value="All">All categories</option>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select>
          <label className="sr-only" htmlFor="auction-status">Auction status</label>
          <select id="auction-status" value={status} onChange={event => setStatus(event.target.value)}><option value="active">Active auctions</option><option value="ended">Ended auctions</option><option value="all">All auctions</option></select>
          <label className="sr-only" htmlFor="auction-sort">Sort auctions</label>
          <select id="auction-sort" value={sort} onChange={event => setSort(event.target.value)}><option value="ending-soon">Ending soon</option><option value="newest">Newest first</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select>
        </div>
      </div>

      {error && auctions.length > 0 && <div className="refresh-error" role="alert"><p>We couldn’t refresh auctions. Showing the last loaded listings. {error}</p><button className="button button-secondary button-sm" type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
      {loading ? <StatePanel loading title="Finding your next favorite…" message="Loading the latest auctions." /> : error && !auctions.length ? <StatePanel title="We couldn’t load the auctions" message={error}><button className="button button-primary" type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></StatePanel> : <>
        <div className="results-count" role="status"><strong>{filtered.length}</strong> {filtered.length === 1 ? 'auction' : 'auctions'}{category !== 'All' ? ` in ${category}` : ' to explore'}<span className="muted">{!isConfigured ? 'Sample collection' : 'Fresh finds, real possibilities'}</span></div>
        {filtered.length > 0 ? <div className="auction-grid">{filtered.map(auction => <AuctionCard auction={auction} key={auction.id} />)}</div> : <StatePanel title={auctions.length === 0 ? 'The marketplace is just getting started' : 'No matches this time'} message={auctions.length === 0 ? 'Be the first to list something worth discovering.' : 'Try another search or adjust your filters.'}>{auctions.length > 0 ? <button className="button button-secondary" type="button" onClick={clearFilters}>Clear filters</button> : <Link className="button button-primary" to="/create">Create an auction <ArrowUpRight size={17} aria-hidden="true" /></Link>}</StatePanel>}
      </>}
    </div>
  );
}
