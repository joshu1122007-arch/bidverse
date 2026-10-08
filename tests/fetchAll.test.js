import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAll } from '../src/lib/fetchAll.js';

function pagedQuery(rows, cap = 1000) {
  const ranges = [];
  return {
    ranges,
    async range(from, to) {
      ranges.push([from, to]);
      return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
    },
  };
}

test('fetchAll continues until empty even when the API cap is lower than the requested range', async () => {
  const rows = Array.from({ length: 5 }, (_, id) => ({ id }));
  const query = pagedQuery(rows, 2);
  assert.deepEqual(await fetchAll(query), rows);
  assert.deepEqual(query.ranges, [[0, 999], [2, 1001], [4, 1003], [5, 1004]]);
});

test('fetchAll returns an empty array for an empty query', async () => {
  const query = pagedQuery([]);
  assert.deepEqual(await fetchAll(query), []);
  assert.deepEqual(query.ranges, [[0, 999]]);
});

test('fetchAll includes all rows when a response fills the entire requested range', async () => {
  const rows = Array.from({ length: 1001 }, (_, id) => ({ id }));
  const query = pagedQuery(rows);
  assert.deepEqual(await fetchAll(query), rows);
  assert.deepEqual(query.ranges, [[0, 999], [1000, 1999], [1001, 2000]]);
});

test('fetchAll propagates page errors instead of returning partial data', async () => {
  const error = new Error('Permission denied');
  const query = { async range(from) { return from === 0 ? { data: [{ id: 1 }], error: null } : { data: null, error }; } };
  await assert.rejects(fetchAll(query), failure => failure === error);
});
