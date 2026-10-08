import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCurrency, getMinimumBid, getAuctionStatus, filterAuctions } from '../src/lib/format.js';

test('first bid starts at the starting price and later bids need a 100 rupee increment', () => {
  assert.equal(getMinimumBid({ starting_price: '4500', highest_bid: null }), 4500);
  assert.equal(getMinimumBid({ starting_price: '4500', highest_bid: '4700.50' }), 4800.5);
});

test('prices use INR and deadlines end exactly at the deadline', () => {
  assert.match(formatCurrency(12500), /12,500/);
  assert.match(formatCurrency(12500.25), /12,500\.25/);
  assert.equal(getAuctionStatus({ end_time: '2026-10-08T12:00:00Z' }, Date.parse('2026-10-08T12:00:00Z')), 'ended');
  assert.equal(getAuctionStatus({ end_time: '2026-10-08T12:00:01Z' }, Date.parse('2026-10-08T12:00:00Z')), 'active');
});

test('filtering supports case-insensitive search, category, status and current price sort', () => {
  const auctions = [
    { title: 'Camera', category: 'Electronics', starting_price: 1000, highest_bid: 5000, end_time: '2026-11-01T00:00:00Z' },
    { title: 'Camera bag', category: 'Accessories', starting_price: 2000, highest_bid: null, end_time: '2026-11-01T00:00:00Z' },
    { title: 'Old Camera', category: 'Electronics', starting_price: 500, end_time: '2026-01-01T00:00:00Z' },
  ];
  const now = Date.parse('2026-10-08T00:00:00Z');
  assert.deepEqual(filterAuctions(auctions, { search: 'CAMERA', category: 'Electronics', status: 'active' }, now).map(a => a.title), ['Camera']);
  assert.deepEqual(filterAuctions(auctions, { status: 'active', sort: 'price-low' }, now).map(a => a.title), ['Camera bag', 'Camera']);
  assert.equal(auctions[0].title, 'Camera');
});
