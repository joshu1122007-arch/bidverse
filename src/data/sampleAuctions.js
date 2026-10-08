const now = Date.now();
const sample = (id, title, category, image, start, highest, bids, hours, description) => ({
  id: `sample-${id}`, title, category, image_url: `/images/${image}.jpg`, starting_price: start,
  highest_bid: highest, bid_count: bids, end_time: new Date(now + hours * 3600000).toISOString(),
  created_at: new Date(now - 86400000).toISOString(), description, seller_name: 'Sample seller',
  seller_id: null, highest_bidder_id: null, winner_id: null, winner_name: null, is_sample: true,
});

// These previews never enter the database and cannot accept bids.
export const sampleAuctions = [
  sample('camera', 'Sony Alpha Camera & Lens', 'Electronics', 'camera', 35000, 42800, 18, 5.7, 'A beautifully designed everyday camera for the moments worth keeping. This is a read-only example listing; connect Supabase to create and bid on real auctions.'),
  sample('headphones', 'Sony WH-1000XM5', 'Electronics', 'headphones', 12000, 16400, 12, 12.3, 'Find your quiet with premium wireless noise-cancelling headphones. A sample listing to preview the BidVerse experience.'),
  sample('sneakers', 'Air Jordan 1 Retro High', 'Fashion', 'sneakers', 8000, 12500, 24, 3.2, 'An iconic silhouette that belongs in every sneaker collection. A sample listing, shown for demonstration only.'),
  sample('watch', 'Classic Automatic Watch', 'Accessories', 'watch', 6500, 8900, 9, 22.8, 'Timeless design, a clean dial, and an automatic movement. Explore this sample listing, then list a real find of your own.'),
  sample('art', 'Mid-century Abstract Print', 'Art', 'art', 1500, null, 0, 32, 'Warm tones and expressive shapes to bring a little character to your space. This is a demonstration listing.'),
  sample('collectible', 'Vintage Film Camera', 'Collectibles', 'vintage', 4000, 6200, 7, 18, 'A piece of photographic history for the curious collector. Read-only sample; product condition and provenance must be provided by a real seller.'),
];
