// Runs jobs that share a key one after another (in this server process), so two requests for the same PO / supplier / order
// cannot read the same balance and both write. For several server instances, back this with a database lock as well.
const tails = new Map<string, Promise<void>>();

export async function serialized<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  const tail = prev.then(() => mine);
  tails.set(key, tail);
  await prev;
  try { return await job(); }
  finally { release(); if (tails.get(key) === tail) tails.delete(key); }
}