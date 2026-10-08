import { History } from 'lucide-react';
import { formatCurrency } from '../lib/format';

export default function BidHistory({ bids = [], currentUserId, isSample = false }) {
  return (
    <section className="bid-history" aria-labelledby="bid-history-heading">
      <div className="section-heading">
        <h2 id="bid-history-heading"><History size={18} aria-hidden="true" /> Bid history</h2>
        <span className="muted">{isSample ? 'Preview only' : `${bids.length} ${bids.length === 1 ? 'bid' : 'bids'}`}</span>
      </div>
      {bids.length === 0 ? (
        <div className="empty-state">
          <p>{isSample ? 'This is a sample listing. Real bids will appear here when bidding is connected.' : 'No bids yet. Make the first move.'}</p>
        </div>
      ) : (
        <ol className="bid-list">
          {bids.map((bid, index) => (
            <li className="bid-row" key={bid.id}>
              <div className="bid-avatar" aria-hidden="true">{(bid.bidder_name || 'B').slice(0, 1).toUpperCase()}</div>
              <div className="bidder-info">
                <strong>{bid.bidder_id === currentUserId ? 'You' : (bid.bidder_name || 'Bidder').trim().split(/\s+/)[0]}</strong>
                <time dateTime={bid.created_at}>{new Date(bid.created_at).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
              </div>
              <div className="bid-amount">
                <strong>{formatCurrency(bid.amount)}</strong>
                {index === 0 && <span className="highest-bid-label">Highest bid</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
