import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Gavel } from 'lucide-react';
import CountdownTimer from './CountdownTimer';
import { formatCurrency, getAuctionStatus } from '../lib/format';

export default function AuctionCard({ auction }) {
  const [now, setNow] = useState(Date.now);
  const ended = getAuctionStatus(auction, now) === 'ended';
  return <article className="auction-card">
    <Link className="card-image-link" to={`/auctions/${auction.id}`} aria-label={`View ${auction.title}`}>
      <img src={auction.image_url} alt={auction.title} loading="lazy" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = '/images/fallback.svg'; }} />
      <span className={`card-live ${ended ? 'is-ended' : ''}`}><span />{auction.is_sample ? 'SAMPLE' : ended ? 'ENDED' : 'LIVE AUCTION'}</span>
      {Number(auction.bid_count) > 0 && <span className="card-bids"><Gavel size={12} />{auction.bid_count} bids</span>}
    </Link>
    <div className="card-body"><span className="card-category">{auction.category}</span><h3><Link to={`/auctions/${auction.id}`}>{auction.title}</Link></h3>
      <div className="card-price-row"><div><span className="card-label">{ended ? 'Final price' : auction.highest_bid == null ? 'Starting price' : 'Current bid'}</span><strong>{formatCurrency(auction.highest_bid ?? auction.starting_price)}</strong></div><div className="card-countdown"><span className="card-label">{ended ? 'Auction status' : 'Ends in'}</span><CountdownTimer endTime={auction.end_time} onExpire={() => setNow(Date.now())} compact /></div></div>
      <div className="card-bottom"><span>Starts at {formatCurrency(auction.starting_price)}</span><Link to={`/auctions/${auction.id}`} className="card-view">View auction <ArrowUpRight size={15} /></Link></div>
    </div>
  </article>;
}
