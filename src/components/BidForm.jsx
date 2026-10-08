import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { supabase, isConfigured } from '../lib/supabase';
import { formatCurrency, getMinimumBid, getAuctionStatus } from '../lib/format';

export default function BidForm({ auction, onBidPlaced }) {
  const { user, loading } = useAuth();
  const notify = useToast();
  const location = useLocation();
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const minimum = getMinimumBid(auction);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setError('');
    if (!isConfigured || auction.is_sample) return setError('Sample listings are read-only. Connect Supabase to place real bids.');
    if (!user) return setError('Please sign in to place a bid.');
    if (user.id === auction.seller_id) return setError('You cannot bid on your own auction.');
    if (getAuctionStatus(auction) === 'ended') return setError('This auction has ended.');
    const value = Number(amount.trim());
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim()) || !Number.isFinite(value) || value <= 0) {
      return setError('Enter a positive amount with at most two decimal places.');
    }
    if (value < minimum) return setError(`Your bid must be at least ${formatCurrency(minimum)}.`);

    setSubmitting(true);
    try {
      const { error: bidError } = await supabase.rpc('place_bid', { p_auction_id: auction.id, p_amount: value });
      if (bidError) throw bidError;
      setAmount('');
      notify('Your bid was placed successfully.');
      onBidPlaced?.();
    } catch (bidError) {
      setError(bidError.message || 'Your bid could not be placed. Please try again.');
      onBidPlaced?.();
    } finally {
      setSubmitting(false);
    }
  }

  if (!isConfigured || auction.is_sample) {
    return <div className="bid-unavailable"><p className="muted">You’re viewing a sample auction. Bidding becomes available when Supabase is connected.</p><span className="status-badge">Read-only preview</span></div>;
  }
  if (getAuctionStatus(auction) === 'ended') return <p className="muted">Bidding is closed for this auction.</p>;
  if (loading) return <p className="muted" role="status">Checking your account…</p>;
  if (user?.id === auction.seller_id) return <p className="muted">This is your auction. Other collectors can place bids here.</p>;
  if (!user) {
    return <div className="bid-unavailable"><p className="muted">Sign in to join the auction and make your next great find.</p><Link className="button button-primary" to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`}>Sign in to bid <ArrowUpRight size={17} aria-hidden="true" /></Link></div>;
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="form-field">
        <label htmlFor="bid-amount">Your bid</label>
        <div className="bid-input-row">
          <span aria-hidden="true">₹</span>
          <input id="bid-amount" name="amount" type="text" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder={String(minimum)} autoComplete="off" disabled={submitting} aria-invalid={Boolean(error)} aria-describedby={`bid-help${error ? ' bid-error' : ''}`} required />
        </div>
        <p className="field-hint" id="bid-help">Minimum bid {formatCurrency(minimum)}{Number(auction.bid_count) > 0 ? ' · ₹100 minimum increment' : ''}</p>
      </div>
      {error && <p className="form-error" id="bid-error" role="alert">{error}</p>}
      <button className="button button-primary bid-submit" type="submit" disabled={submitting}>{submitting ? 'Placing your bid…' : 'Place bid'} {!submitting && <ArrowUpRight size={18} aria-hidden="true" />}</button>
      <p className="bid-security"><ShieldCheck size={14} aria-hidden="true" /> Every bid is verified before it’s accepted.</p>
    </form>
  );
}
