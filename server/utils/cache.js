// Small dependency-free in-memory cache: TTL + LRU eviction + in-flight
// de-duplication ("single flight"), so N identical concurrent requests
// result in ONE upstream call. Used for OpenAlex searches, AI responses,
// paper rows and auth sessions.

class TTLCache {
  constructor({ name = 'cache', max = 500, ttlMs = 60_000 } = {}) {
    this.name = name;
    this.max = max;
    this.ttlMs = ttlMs;
    this.map = new Map(); // key -> { value, expiresAt }
    this.inflight = new Map(); // key -> Promise
    this.hits = 0;
    this.misses = 0;
    this.staleServed = 0;
  }

  // Returns the cached value, or undefined if missing/expired.
  // With { allowStale: true } an expired entry is still returned
  // (used for "serve stale if the upstream is down").
  get(key, { allowStale = false } = {}) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now() && !allowStale) {
      this.map.delete(key);
      return undefined;
    }
    // LRU touch
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    return value;
  }

  delete(key) {
    return this.map.delete(key);
  }

  deletePrefix(prefix) {
    for (const key of this.map.keys()) {
      if (String(key).startsWith(prefix)) this.map.delete(key);
    }
  }

  clear() {
    this.map.clear();
  }

  // get-or-compute with in-flight de-duplication.
  //   bypass:  skip reading the cache (still stores the fresh value)
  //   ttlMs:   per-call TTL override
  //   staleOnError: if compute() throws and an expired value exists, serve it
  //   shouldCache:  predicate on the computed value; false = return but don't store
  async wrap(key, compute, { bypass = false, ttlMs, staleOnError = false, shouldCache = () => true } = {}) {
    if (!bypass) {
      const cached = this.get(key);
      if (cached !== undefined) {
        this.hits += 1;
        return cached;
      }
    }
    if (this.inflight.has(key) && !bypass) return this.inflight.get(key);

    this.misses += 1;
    const promise = (async () => {
      try {
        const value = await compute();
        if (value !== undefined && shouldCache(value)) this.set(key, value, ttlMs);
        return value;
      } catch (err) {
        if (staleOnError) {
          const stale = this.get(key, { allowStale: true });
          if (stale !== undefined) {
            this.staleServed += 1;
            return stale;
          }
        }
        throw err;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }

  stats() {
    return {
      name: this.name,
      size: this.map.size,
      hits: this.hits,
      misses: this.misses,
      staleServed: this.staleServed,
    };
  }
}

module.exports = { TTLCache };
