export const categories = ['Electronics', 'Fashion', 'Collectibles', 'Art', 'Accessories', 'Other'];

export function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
}

export function getMinimumBid(auction) {
  return auction.highest_bid == null ? Number(auction.starting_price) : Math.round((Number(auction.highest_bid) + 100) * 100) / 100;
}

export function getAuctionStatus(auction, now = Date.now()) {
  return new Date(auction.end_time).getTime() <= now ? 'ended' : 'active';
}

export function filterAuctions(auctions, { search = '', category = 'All', status = 'active', sort = 'ending-soon' } = {}, now = Date.now()) {
  const price = (auction) => Number(auction.highest_bid ?? auction.starting_price);
  return auctions.filter((auction) =>
    auction.title.toLowerCase().includes(search.trim().toLowerCase()) &&
    (!category || category === 'All' || category === 'all' || auction.category === category) &&
    (status === 'all' || getAuctionStatus(auction, now) === status)
  ).sort((a, b) => {
    if (sort === 'price-low') return price(a) - price(b);
    if (sort === 'price-high') return price(b) - price(a);
    if (sort === 'newest') return new Date(b.created_at) - new Date(a.created_at);
    return new Date(a.end_time) - new Date(b.end_time);
  });
}
