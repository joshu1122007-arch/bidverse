export async function fetchAll(query) {
  const rows = [];
  // ponytail: offset pages are not a snapshot; use server cursor pagination if concurrent edits cause gaps.
  while (true) {
    const { data, error } = await query.range(rows.length, rows.length + 999);
    if (error) throw error;
    if (!data?.length) return rows;
    rows.push(...data);
  }
}
