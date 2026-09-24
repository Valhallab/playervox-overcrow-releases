// The provider permits three requests per second. Keep one active read and
// one replaceable pending read, so rapid selections cannot accumulate work.
export function createPacedFetch(fetchJson) {
  let active = null;
  let pending = null;
  let running = false;
  let nextStart = 0;

  async function drain() {
    running = true;
    while (pending) {
      const delay = Math.max(0, nextStart - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      active = pending;
      pending = null;
      nextStart = Date.now() + 400;
      try {
        active.resolve(await fetchJson(active.url));
      } catch (error) {
        active.reject(error);
      }
      active = null;
    }
    running = false;
  }

  return (url) => {
    if (active?.url === url) {
      pending?.reject(new Error('request superseded'));
      pending = null;
      return active.promise;
    }
    if (pending?.url === url) return pending.promise;
    pending?.reject(new Error('request superseded'));
    const job = { url };
    job.promise = new Promise((resolve, reject) => Object.assign(job, { resolve, reject }));
    pending = job;
    if (!running) void drain();
    return job.promise;
  };
}
