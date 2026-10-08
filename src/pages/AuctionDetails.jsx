import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, CircleCheck, Radio, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import BidForm from '../components/BidForm';
import BidHistory from '../components/BidHistory';
import CountdownTimer from '../components/CountdownTimer';
import StatePanel from '../components/StatePanel';
import { useAuth } from '../context/AuthContext';
import { supabase, isConfigured } from '../lib/supabase';
import { formatCurrency, getAuctionStatus, getMinimumBid } from '../lib/format';
import { fetchAll } from '../lib/fetchAll';
import { sampleAuctions } from '../data/sampleAuctions';

export default function AuctionDetails() {
  const { id } = useParams();
  const { user } = useAuth();
  const [auction, setAuction] = useState(null);
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('connecting');
  const [now, setNow] = useState(Date.now);
  const request = useRef(0);
  const inFlight = useRef(null);
  const queued = useRef(false);
  const activeId = useRef(null);

  const refresh = useCallback(async () => {
    if (!isConfigured || activeId.current !== id) return;
    if (inFlight.current !== null) { queued.current = true; return; }
    const current = ++request.current;
    inFlight.current = current;
    try {
      const [auctionResult, history] = await Promise.all([
        supabase.from('auction_summaries').select('*').eq('id', id).maybeSingle(),
        fetchAll(supabase.from('bid_history').select('*').eq('auction_id', id).order('amount', { ascending: false }).order('id', { ascending: true })),
      ]);
      if (auctionResult.error) throw auctionResult.error;
      if (current !== request.current) return;
      setAuction(auctionResult.data);
      setBids(history);
      setNow(Date.now());
      setError('');
    } catch (fetchError) {
      if (current === request.current) setError(fetchError.message || 'The auction could not be refreshed. Please try again.');
    } finally {
      if (current === request.current) {
        setLoading(false);
        inFlight.current = null;
        if (queued.current) { queued.current = false; refresh(); }
      }
    }
  }, [id]);

  useEffect(() => {
    setAuction(null);
    setBids([]);
    setError('');
    setLoading(true);
    setNow(Date.now());
    if (!isConfigured) {
      setAuction(sampleAuctions.find(item => item.id === id) || null);
      setLoading(false);
      setConnection('sample');
      return;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      setLoading(false);
      return;
    }
    activeId.current = id;
    setConnection('connecting');
    refresh();
    const interval = setInterval(refresh, 15000);
    const channel = supabase.channel(`auction-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bids', filter: `auction_id=eq.${id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions', filter: `id=eq.${id}` }, refresh)
      .subscribe(status => {
        if (activeId.current !== id) return;
        if (status === 'SUBSCRIBED') setConnection('live');
        else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) setConnection('polling');
      });
    return () => {
      request.current += 1;
      activeId.current = null;
      inFlight.current = null;
      queued.current = false;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [id, refresh]);

  const handleExpiry = useCallback(() => {
    setNow(Date.now());
    refresh();
  }, [refresh]);

  if (loading || (auction && auction.id !== id)) return <div className="container page-shell"><StatePanel loading title="Opening the auction…" message="Getting the latest listing and bids." /></div>;
  if (!auction) return <div className="container page-shell"><StatePanel title={error ? 'We couldn’t open this auction' : 'This auction isn’t here'} message={error || 'The listing may have been removed, or the link may be incorrect.'}>{error && <button className="button button-primary" type="button" onClick={() => { setLoading(true); refresh(); }}>Try again</button>}<Link className="button button-secondary" to="/explore">Explore auctions</Link></StatePanel></div>;

  const ended = getAuctionStatus(auction, now) === 'ended';
  const hasBids = Number(auction.bid_count) > 0;
  const sellerName = (auction.seller_name || 'Seller').trim().split(/\s+/)[0];

  return (
    <div className="container page-shell auction-detail-page">
      <Link className="back-link" to="/explore"><ArrowLeft size={16} aria-hidden="true" /> Back to explore</Link>
      {auction.is_sample && <div className="config-banner"><div><strong>Sample auction · read-only preview</strong><p>Connect Supabase using the setup guide in README to create listings and accept real bids.</p></div><ArrowUpRight size={22} aria-hidden="true" /></div>}
      {error && <div className="refresh-error" role="alert"><p>We couldn’t refresh this auction. Displayed bids may be out of date. {error}</p><button className="button button-secondary button-sm" type="button" onClick={refresh}>Retry</button></div>}

      <div className="detail-layout">
        <div className="detail-content">
          <div className="detail-image"><img src={auction.image_url || '/images/fallback.svg'} alt={auction.title} onError={event => { if (!event.currentTarget.src.endsWith('/images/fallback.svg')) event.currentTarget.src = '/images/fallback.svg'; }} /><span className={`status-badge ${ended ? 'status-ended' : 'status-active'}`}>{auction.is_sample ? 'Sample listing' : ended ? 'Auction ended' : 'Live auction'}</span></div>
          <section className="panel detail-description" aria-labelledby="about-item-heading"><div className="section-heading"><h2 id="about-item-heading">About this find</h2></div><p>{auction.description}</p><div className="detail-seller"><div className="seller-avatar"><UserRound size={19} aria-hidden="true" /></div><div><span className="muted">Listed by</span><strong>{sellerName}{user?.id === auction.seller_id ? ' (you)' : ''}</strong></div></div></section>
          <div className="panel"><BidHistory bids={bids} currentUserId={user?.id} isSample={auction.is_sample} /></div>
        </div>

        <aside className="detail-summary" aria-label="Auction summary and bidding">
          <div className="detail-title"><span className="eyebrow">{auction.category}</span><h1>{auction.title}</h1><p className="muted">Something special. A story to make your own.</p></div>
          <div className="panel bid-panel">
            <div className="live-status"><span className={`live-dot${connection === 'live' ? ' connected' : ''}`} aria-hidden="true" /><Radio size={14} aria-hidden="true" /><span>{auction.is_sample ? 'Sample auction · bidding unavailable' : connection === 'live' ? 'Live updates connected' : connection === 'connecting' ? 'Connecting · refreshes every 15 seconds' : 'Refreshes every 15 seconds'}</span></div>
            <p className="current-bid-label">{auction.is_sample ? 'Example price' : ended ? hasBids ? 'Final bid' : 'Starting price' : hasBids ? 'Current bid' : 'Starting bid'}</p><p className="current-bid-value">{formatCurrency(auction.highest_bid ?? auction.starting_price)}</p>
            <div className="detail-meta"><span>{Number(auction.bid_count || 0)} {auction.is_sample ? 'example ' : ''}{Number(auction.bid_count) === 1 ? 'bid' : 'bids'}</span><span>{ended ? 'Bidding closed' : `Next bid ${formatCurrency(getMinimumBid(auction))}`}</span></div>
            <div className="auction-deadline"><span className="muted">{ended ? 'Auction ended' : 'Time remaining'}</span><CountdownTimer endTime={auction.end_time} onExpire={handleExpiry} /><time dateTime={auction.end_time}>{new Date(auction.end_time).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</time></div>
            {ended && !auction.is_sample && <div className="auction-result"><Trophy size={20} aria-hidden="true" /><div><strong>{auction.winner_id ? auction.winner_id === user?.id ? 'You won this auction!' : `Won by ${auction.winner_name ? auction.winner_name.trim().split(/\s+/)[0] : 'the highest bidder'}` : hasBids ? 'Confirming the final result' : 'Ended with no bids'}</strong><p className="muted">{auction.winner_id ? 'The highest accepted bid takes the find.' : hasBids ? 'The result updates after the server confirms the deadline.' : 'This find didn’t receive a bid this time.'}</p></div></div>}
            <BidForm key={auction.id} auction={auction} onBidPlaced={refresh} />
            <div className="starting-price"><span className="muted">Starting price</span><strong>{formatCurrency(auction.starting_price)}</strong></div>
          </div>
          <div className="detail-assurance"><ShieldCheck size={18} aria-hidden="true" /><p>Fair bidding. Every time.<span className="muted">Bids are validated securely. The highest accepted bid wins.</span></p><CircleCheck size={17} aria-hidden="true" /></div>
        </aside>
      </div>
    </div>
  );
}
