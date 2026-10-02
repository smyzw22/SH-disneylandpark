/** 简单内存 TTL 缓存 */

class MemoryCache {
  constructor(defaultTtlMs = 60_000) {
    this.defaultTtlMs = defaultTtlMs;
    /** @type {Map<string, { value: unknown, expiresAt: number }>} */
    this.store = new Map();
  }

  /**
   * @param {string} key
   * @param {() => Promise<unknown> | unknown} factory
   * @param {number} [ttlMs]
   */
  async wrap(key, factory, ttlMs = this.defaultTtlMs) {
    const hit = this.get(key);
    if (hit !== undefined) {
      return { data: hit, cached: true };
    }
    const value = await factory();
    this.set(key, value, ttlMs);
    return { data: value, cached: false };
  }

  /**
   * @param {string} key
   */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * @param {string} key
   * @param {unknown} value
   * @param {number} [ttlMs]
   */
  set(key, value, ttlMs = this.defaultTtlMs) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  clear() {
    this.store.clear();
  }
}

module.exports = { MemoryCache };
