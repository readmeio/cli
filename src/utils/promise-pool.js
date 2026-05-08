/**
 * Run `worker` over `items` with at most `concurrency` calls in flight.
 * Each worker pulls the next item from a shared cursor; finishes when none left.
 * `worker(item, index, workerIdx)` is responsible for catching its own errors —
 * an uncaught rejection will propagate up and abort other in-flight workers.
 */
export async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const next = () => (cursor < items.length ? cursor++ : -1);
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: lanes }, (_, workerIdx) => (async () => {
    for (let i = next(); i !== -1; i = next()) {
      await worker(items[i], i, workerIdx);
    }
  })());
  await Promise.all(workers);
}
