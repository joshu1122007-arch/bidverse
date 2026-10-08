import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Gavel, LayoutGrid, Plus, Trash2, Trophy } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { supabase } from '../lib/supabase';
import { formatCurrency, getAuctionStatus } from '../lib/format';
import { fetchAll } from '../lib/fetchAll';
import StatePanel from '../components/StatePanel';

export default function Dashboard() {
  const { user } = useAuth();
  const notify = useToast();
  const [data, setData] = useState({ ownerId: null, listings: [], bidding: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    if (!supabase || !user) { setLoading(false); return; }
    let mounted = true;
    let inFlight = false;
    const refresh = async (initial = false) => {
      if (inFlight) return;
      inFlight = true;
      if (initial) setLoading(true);
      try {
        const [listings, bids] = await Promise.all([
          fetchAll(supabase.from('auction_summaries').select('*').eq('seller_id', user.id).order('created_at', { ascending: false }).order('id', { ascending: true })),
          fetchAll(supabase.from('bid_history').select('auction_id,amount').eq('bidder_id', user.id).order('created_at', { ascending: false }).order('id', { ascending: true })),
        ]);
        const ownBids = new Map();
        for (const bid of bids) ownBids.set(bid.auction_id, Math.max(ownBids.get(bid.auction_id) ?? 0, Number(bid.amount)));
        let bidding = [];
        if (ownBids.size) {
          const ids = [...ownBids.keys()];
          const auctions = [];
          for (let offset = 0; offset < ids.length; offset += 100) {
            auctions.push(...await fetchAll(supabase.from('auction_summaries').select('*').in('id', ids.slice(offset, offset + 100)).order('end_time', { ascending: true }).order('id', { ascending: true })));
          }
          bidding = auctions.map((auction) => ({ ...auction, myBid: ownBids.get(auction.id) }))
            .sort((a, b) => new Date(a.end_time) - new Date(b.end_time) || a.id.localeCompare(b.id));
        }
        if (mounted) { setData({ ownerId: user.id, listings, bidding }); setError(''); }
      } catch (failure) {
        if (mounted) setError(failure.message || 'Your dashboard could not be loaded. Please try again.');
      } finally {
        inFlight = false;
        if (mounted) setLoading(false);
      }
    };
    refresh(true);
    const timer = setInterval(() => refresh(), 15000);
    return () => { mounted = false; clearInterval(timer); };
  }, [user?.id, revision]);

  const listings = data.ownerId === user?.id ? data.listings : [];
  const bidding = data.ownerId === user?.id ? data.bidding : [];
  const won = bidding.filter((auction) => auction.winner_id === user?.id);
  const active = listings.filter((auction) => getAuctionStatus(auction) === 'active');

  const removeAuction = async (auction) => {
    if (deletingId || !user || !supabase || getAuctionStatus(auction) !== 'active' || Number(auction.bid_count) !== 0) return;
    if (!window.confirm(`Delete "${auction.title}"? This cannot be undone.`)) return;
    setDeletingId(auction.id);
    try {
      const { data: deleted, error: deleteError } = await supabase.from('auctions').delete().eq('id', auction.id).eq('seller_id', user.id).select('id');
      if (deleteError) throw deleteError;
      if (deleted?.length !== 1) throw new Error('The listing was not deleted. It may have changed or no longer belong to your account.');
      notify('Your auction was deleted.');
      const path = auction.image_url?.split('/storage/v1/object/public/auction-images/')[1];
      if (path?.startsWith(`${user.id}/`)) {
        try {
          const { error: cleanupError } = await supabase.storage.from('auction-images').remove([decodeURIComponent(path)]);
          if (cleanupError) throw cleanupError;
        } catch { notify('Listing deleted, but its uploaded image could not be removed.', 'error'); }
      }
    } catch (failure) { notify(failure.message || 'Unable to delete this auction. Please try again.', 'error'); }
    finally { setDeletingId(null); setRevision((value) => value + 1); }
  };

  const bidStatus = (auction) => auction.winner_id === user?.id ? 'Won' : getAuctionStatus(auction) === 'ended' ? 'Ended' : auction.highest_bidder_id === user?.id ? 'Leading' : 'Outbid';
  const bidRows = (items) => <div className="account-bid-list">{items.map((auction) => <article className="account-bid-row" key={auction.id}>
    <Link className="table-auction" to={`/auctions/${auction.id}`}><img src={auction.image_url} alt="" loading="lazy" /><span><strong>{auction.title}</strong><span className="muted">{auction.category}</span></span></Link>
    <div><span className="field-hint">Your highest bid</span><strong>{formatCurrency(auction.myBid)}</strong></div><div><span className="field-hint">Highest bid</span><strong>{formatCurrency(auction.highest_bid ?? auction.starting_price)}</strong></div><span className={`status-badge status-${bidStatus(auction).toLowerCase()}`}>{bidStatus(auction)}</span><Link className="button button-secondary button-sm" to={`/auctions/${auction.id}`} aria-label={`View ${auction.title}`}>View<ArrowUpRight size={15} /></Link>
  </article>)}</div>;

  return <div className="container page-shell">
    <div className="page-heading"><div><span className="eyebrow">YOUR LITTLE CORNER OF BIDVERSE</span><h1>My dashboard<span className="accent-text">.</span></h1><p className="muted">Keep an eye on your listings, your bids, and your next great win.</p></div><Link to="/create" className="button button-primary"><Plus size={18} />Create auction</Link></div>
    {loading ? <StatePanel loading title="Gathering your auctions..." /> : error && data.ownerId !== user?.id ? <StatePanel title="Your dashboard could not be loaded" message={error}><button className="button button-secondary" onClick={() => setRevision((value) => value + 1)}>Try again</button></StatePanel> : <>
      {error && <div className="config-banner" role="alert"><p>{error}</p>{data.ownerId === user?.id && <p>Showing the last loaded data. Your dashboard refreshes every 15 seconds.</p>}<button className="button button-secondary button-sm" onClick={() => setRevision((value) => value + 1)}>Try again</button></div>}
      <div className="dashboard-stats">{[[LayoutGrid, 'Active listings', active.length], [Gavel, 'Total listings', listings.length], [ArrowUpRight, 'Auctions bid on', bidding.length], [Trophy, 'Auctions won', won.length]].map(([Icon, label, value]) => <div className="stat-card" key={label}><span className="stat-icon"><Icon size={21} /></span><span className="muted">{label}</span><strong>{value}</strong></div>)}</div>
      <section className="dashboard-section" aria-labelledby="listings-heading"><div className="section-heading"><div><h2 id="listings-heading">My listings <span className="count-pill">{listings.length}</span></h2><p className="muted">Your items, out there making new connections.</p></div><Link className="inline-link" to="/create">Add a listing<Plus size={16} /></Link></div>
        {listings.length ? <div className="panel dashboard-table"><table><thead><tr><th scope="col">Item</th><th scope="col">Current price</th><th scope="col">Bids</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>{listings.map((auction) => <tr key={auction.id}><td><Link className="table-auction" to={`/auctions/${auction.id}`}><img src={auction.image_url} alt="" loading="lazy" /><span><strong>{auction.title}</strong><span className="muted">{auction.category}</span></span></Link></td><td><strong>{formatCurrency(auction.highest_bid ?? auction.starting_price)}</strong></td><td>{Number(auction.bid_count)}</td><td><span className={`status-badge status-${getAuctionStatus(auction)}`}>{getAuctionStatus(auction) === 'active' ? 'Active' : 'Ended'}</span>{getAuctionStatus(auction) === 'ended' && <span className="field-hint">{auction.winner_id ? `Won by ${auction.winner_name || 'a bidder'}` : Number(auction.bid_count) === 0 ? 'No bids received' : 'Confirming result...'}</span>}</td><td><div className="table-actions"><Link className="button button-secondary button-sm" to={`/auctions/${auction.id}`}>View</Link>{getAuctionStatus(auction) === 'active' && Number(auction.bid_count) === 0 && <button className="button button-secondary button-sm" aria-label={`Delete ${auction.title}`} disabled={Boolean(deletingId)} onClick={() => removeAuction(auction)}><Trash2 size={15} />{deletingId === auction.id ? 'Deleting...' : 'Delete'}</button>}</div></td></tr>)}</tbody></table></div> : <StatePanel title="Your first listing is waiting" message="Give something great a new home. Create an auction and let the right buyer discover it."><Link className="button button-primary" to="/create">Create an auction<Plus size={16} /></Link></StatePanel>}
      </section>
      <section className="dashboard-section" aria-labelledby="bids-heading"><div className="section-heading"><div><h2 id="bids-heading">My bids <span className="count-pill">{bidding.length}</span></h2><p className="muted">All the things you have your eye on.</p></div><Link className="inline-link" to="/explore">Find your next bid<ArrowUpRight size={16} /></Link></div>{bidding.length ? bidRows(bidding) : <StatePanel title="Something will catch your eye" message="Explore the auctions and make your first bid on something worth finding."><Link className="button button-secondary" to="/explore">Explore auctions</Link></StatePanel>}</section>
      <section className="dashboard-section" aria-labelledby="wins-heading"><div className="section-heading"><div><h2 id="wins-heading"><Trophy size={22} /> My wins <span className="count-pill">{won.length}</span></h2><p className="muted">The finds you made your own.</p></div></div>{won.length ? bidRows(won) : <StatePanel title="Your next win is out there" message="When an auction ends with you in the lead, you will find it here." />}</section>
    </>}
  </div>;
}
