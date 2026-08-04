// Simple TTL cache for high-frequency reads
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LocalCache = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_TTL = 30000; // 30 seconds

  function create() {
    const store = new Map();

    return {
      get(key) {
        const entry = store.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expires) {
          store.delete(key);
          return null;
        }
        return entry.value;
      },

      set(key, value, ttlMs) {
        store.set(key, {
          value,
          expires: Date.now() + (typeof ttlMs === 'number' ? ttlMs : DEFAULT_TTL)
        });
      },

      delete(key) {
        store.delete(key);
      },

      // Invalidate all entries matching a prefix
      invalidatePrefix(prefix) {
        for (const key of store.keys()) {
          if (String(key).startsWith(prefix)) store.delete(key);
        }
      },

      clear() {
        store.clear();
      }
    };
  }

  return { create };
});
