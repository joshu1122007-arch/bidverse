import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { formatCurrency, getMinimumBid, getAuctionStatus } from '../src/lib/format.js';

// Run the real handlers without introducing a DOM test dependency.
function componentSource(path, start, end) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, 'The component changed; update this focused self-check.');
  return source.slice(first, last);
}

const countdownSource = componentSource('../src/components/CountdownTimer.jsx', 'export default function CountdownTimer', '\n  if (!Number.isFinite(deadline)) return <')
  .replace('export default ', '') + '\nreturn null; }\nCountdownTimer;';
const submitSource = componentSource('../src/components/BidForm.jsx', '  async function handleSubmit', '\n  if (!isConfigured || auction.is_sample) {') + '\nhandleSubmit;';

function countdownHarness(now) {
  const effects = [];
  const intervals = new Map();
  const refs = [];
  let refIndex = 0;
  let nextInterval = 0;
  let clock = now;
  const component = vm.runInNewContext(countdownSource, {
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: initial => refs[refIndex++] ||= { current: initial },
    useEffect: effect => effects.push(effect),
    Date: class extends Date { static now() { return clock; } },
    Number,
    setInterval: tick => { intervals.set(++nextInterval, tick); return nextInterval; },
    clearInterval: interval => intervals.delete(interval),
  });
  return {
    render(props) { refIndex = 0; component(props); },
    startEffect: () => effects.at(-1)(),
    tick(time) { clock = time; for (const tick of intervals.values()) tick(); },
    intervals,
  };
}

test('countdown expires once, survives StrictMode replay, and cleans up its interval', () => {
  const start = Date.parse('2026-10-08T12:00:00Z');
  const timer = countdownHarness(start);
  let expired = 0;
  timer.render({ endTime: new Date(start + 1000).toISOString(), onExpire: () => expired++ });
  const cleanup = timer.startEffect();
  assert.equal(expired, 0);
  timer.tick(start + 1000);
  timer.tick(start + 2000);
  assert.equal(expired, 1);
  cleanup();
  assert.equal(timer.intervals.size, 0);
  const replayCleanup = timer.startEffect();
  assert.equal(expired, 1);
  replayCleanup();
  assert.equal(timer.intervals.size, 0);
});

test('countdown uses the latest expiry callback and handles a new deadline', () => {
  const start = Date.parse('2026-10-08T12:00:00Z');
  const timer = countdownHarness(start);
  let oldCalls = 0;
  let latestCalls = 0;
  const endTime = new Date(start + 1000).toISOString();
  timer.render({ endTime, onExpire: () => oldCalls++ });
  const cleanup = timer.startEffect();
  timer.render({ endTime, onExpire: () => latestCalls++ });
  timer.tick(start + 1000);
  assert.equal(oldCalls, 0);
  assert.equal(latestCalls, 1);
  cleanup();
  timer.render({ endTime: new Date(start + 2000).toISOString(), onExpire: () => latestCalls++ });
  const nextCleanup = timer.startEffect();
  timer.tick(start + 2000);
  assert.equal(latestCalls, 2);
  nextCleanup();
});

test('invalid countdown deadlines neither schedule work nor announce expiry', () => {
  const timer = countdownHarness(Date.now());
  timer.render({ endTime: 'invalid', onExpire: () => assert.fail('An invalid date cannot expire') });
  assert.equal(timer.startEffect(), undefined);
  assert.equal(timer.intervals.size, 0);
});

async function submit(amount, options = {}) {
  let message = '';
  let successes = 0;
  let request;
  let busy = false;
  const auction = { id: 'test', seller_id: 'seller', starting_price: 100, highest_bid: null, end_time: '2099-01-01T00:00:00Z', ...options.auction };
  const handler = vm.runInNewContext(submitSource, {
    amount, auction, minimum: getMinimumBid(auction), submitting: false, isConfigured: options.isConfigured ?? true,
    user: options.anonymous ? null : { id: 'bidder' }, getAuctionStatus, formatCurrency,
    setError: value => { message = value; }, setAmount: () => {}, setSubmitting: value => { busy = value; },
    notify: () => { successes++; }, onBidPlaced: () => {},
    supabase: { rpc: async (name, args) => { request = { name, id: args.p_auction_id, amount: args.p_amount }; return { error: options.serverError ? { message: 'Auction has ended' } : null }; } },
  });
  await handler({ preventDefault() {} });
  return { message, successes, request, busy };
}

test('bids reject invalid precision, non-positive amounts and bids below the minimum', async () => {
  for (const value of ['100.001', '0', '-100', 'NaN', 'Infinity', '1e3', '']) {
    const result = await submit(value);
    assert.match(result.message, /positive|two decimal/);
    assert.equal(result.request, undefined);
    assert.equal(result.successes, 0);
  }
  assert.match((await submit('99')).message, /at least/);
  assert.match((await submit('199', { auction: { highest_bid: 100 } })).message, /at least/);
});

test('anonymous, self, expired and sample bids never reach the server', async () => {
  for (const options of [
    { anonymous: true },
    { auction: { seller_id: 'bidder' } },
    { auction: { end_time: '2000-01-01T00:00:00Z' } },
    { auction: { is_sample: true } },
    { isConfigured: false },
  ]) {
    const result = await submit('100', options);
    assert.ok(result.message);
    assert.equal(result.request, undefined);
    assert.equal(result.successes, 0);
  }
});

test('a server rejection stays visible and never announces success', async () => {
  const result = await submit('100', { serverError: true });
  assert.equal(result.message, 'Auction has ended');
  assert.equal(result.successes, 0);
  assert.equal(result.busy, false);
});

test('an accepted bid sends numeric money through place_bid and announces success', async () => {
  const result = await submit('100.25');
  assert.deepEqual(result.request, { name: 'place_bid', id: 'test', amount: 100.25 });
  assert.equal(result.message, '');
  assert.equal(result.successes, 1);
  assert.equal(result.busy, false);
});
