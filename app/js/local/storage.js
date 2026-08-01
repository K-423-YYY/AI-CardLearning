(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LocalStorage = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const DB_NAME = 'ai-learn-local';
  const DB_VERSION = 1;

  const STORES = [
    'settings',
    'meta',
    'keys',
    'zones',
    'files',
    'cards',
    'records',
    'provider_configs',
    'zone_settings',
    'levels',
    'level_cards',
    'review_schedule',
    'daily_tasks',
    'checkins'
  ];

  function open() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('当前环境不支持 IndexedDB'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        STORES.forEach((store) => {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store, { keyPath: 'id' });
          }
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB 被其他页面占用，请关闭其他标签页'));
    });
  }

  let dbPromise = null;

  function getDb() {
    if (!dbPromise) dbPromise = open();
    return dbPromise;
  }

  function withStore(storeName, mode, fn) {
    return getDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, mode);
          const store = tx.objectStore(storeName);
          let result;
          try {
            result = fn(store);
          } catch (err) {
            reject(err);
            return;
          }
          tx.oncomplete = () => Promise.resolve(result).then(resolve, reject);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('事务已中止'));
        })
    );
  }

  function requestToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function all(storeName) {
    return withStore(storeName, 'readonly', (store) => requestToPromise(store.getAll()));
  }

  function get(storeName, key) {
    return withStore(storeName, 'readonly', (store) => requestToPromise(store.get(key)));
  }

  function put(storeName, row) {
    return withStore(storeName, 'readwrite', (store) => requestToPromise(store.put(row)));
  }

  function remove(storeName, key) {
    return withStore(storeName, 'readwrite', (store) => requestToPromise(store.delete(key)));
  }

  function clear(storeName) {
    return withStore(storeName, 'readwrite', (store) => requestToPromise(store.clear()));
  }

  function count(storeName) {
    return withStore(storeName, 'readonly', (store) => requestToPromise(store.count()));
  }

  return {
    DB_NAME,
    DB_VERSION,
    STORES,
    open,
    getDb,
    all,
    get,
    put,
    delete: remove,
    clear,
    count
  };
});
