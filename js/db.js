/**
 * Photo Catalog — IndexedDB Storage Module
 * Manages photo records with original high-resolution blobs and lightweight thumbnails.
 */

const DB_NAME = 'PhotoCatalogDB';
const DB_VERSION = 1;
const STORE_NAME = 'photos';

class Database {
  constructor() {
    this.db = null;
    this._initPromise = null;
  }

  /**
   * Initializes and opens the IndexedDB database.
   * @returns {Promise<IDBDatabase>}
   */
  async getDB() {
    if (this.db) return this.db;
    if (this._initPromise) return this._initPromise;

    this._initPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB не поддерживается вашим браузером.'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        this.db.onversionchange = () => {
          this.db.close();
          this.db = null;
        };
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject(event.target.error || new Error('Ошибка открытия базы данных.'));
      };

      request.onblocked = () => {
        console.warn('Открытие IndexedDB заблокировано другим соединением.');
      };
    });

    return this._initPromise;
  }

  /**
   * Generates a unique record identifier.
   */
  generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'photo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  /**
   * Saves a new photo record into IndexedDB.
   * @param {Object} param0
   * @param {Blob} param0.originalBlob - Full resolution image Blob
   * @param {Blob} param0.thumbnailBlob - Compressed thumbnail Blob
   * @param {number} param0.width - Image width
   * @param {number} param0.height - Image height
   * @param {number} [param0.timestamp] - Unix timestamp (ms)
   * @param {string} [param0.id] - Optional ID (generated if not provided)
   * @returns {Promise<Object>} The saved photo metadata
   */
  async savePhoto({ originalBlob, thumbnailBlob, width, height, timestamp, id }) {
    const db = await this.getDB();
    const photoId = id || this.generateId();
    const now = timestamp || Date.now();
    const sizeBytes = originalBlob ? originalBlob.size : 0;

    const record = {
      id: photoId,
      timestamp: now,
      createdAt: new Date(now).toISOString(),
      width: width || 0,
      height: height || 0,
      sizeBytes,
      originalBlob,
      thumbnailBlob: thumbnailBlob || originalBlob,
    };

    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(record);

        request.onsuccess = () => {
          resolve(record);
        };

        request.onerror = (event) => {
          const err = event.target.error;
          if (err && err.name === 'QuotaExceededError') {
            reject(new Error('Недостаточно свободного места в памяти устройства для сохранения фотографии.'));
          } else {
            reject(err || new Error('Не удалось сохранить фото в IndexedDB.'));
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Retrieves all photo records sorted by timestamp (newest first).
   * Note: omits originalBlob by default for memory efficiency in gallery view unless specified.
   * @param {boolean} [includeOriginal=false]
   * @returns {Promise<Array<Object>>}
   */
  async getAllPhotos(includeOriginal = false) {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('timestamp');
        // Open cursor descending (newest first)
        const request = index.openCursor(null, 'prev');
        const results = [];

        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const val = cursor.value;
            if (!includeOriginal) {
              const { originalBlob, ...meta } = val;
              results.push(meta);
            } else {
              results.push(val);
            }
            cursor.continue();
          } else {
            resolve(results);
          }
        };

        request.onerror = (event) => {
          reject(event.target.error || new Error('Ошибка чтения картотеки.'));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Retrieves a single photo record by ID (including full originalBlob).
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getPhotoById(id) {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = (event) => {
          resolve(event.target.result || null);
        };

        request.onerror = (event) => {
          reject(event.target.error || new Error('Ошибка загрузки фото.'));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Deletes a photo record by ID.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async deletePhoto(id) {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => {
          resolve(true);
        };

        request.onerror = (event) => {
          reject(event.target.error || new Error('Не удалось удалить фотографию.'));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Returns total count of photos in the catalog.
   * @returns {Promise<number>}
   */
  async getPhotoCount() {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.count();

        request.onsuccess = (event) => {
          resolve(event.target.result || 0);
        };

        request.onerror = (event) => {
          reject(event.target.error || new Error('Ошибка подсчёта записей.'));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Clears all photos from the database.
   * @returns {Promise<boolean>}
   */
  async clearAllPhotos() {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => {
          resolve(true);
        };

        request.onerror = (event) => {
          reject(event.target.error || new Error('Не удалось очистить картотеку.'));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Inserts multiple photo records in a single transaction (used for backup restore).
   * @param {Array<Object>} records
   * @returns {Promise<number>} count of imported records
   */
  async batchInsertPhotos(records) {
    if (!records || records.length === 0) return 0;
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        let count = 0;

        transaction.oncomplete = () => {
          resolve(count);
        };

        transaction.onerror = (event) => {
          reject(event.target.error || new Error('Ошибка импорта фотографий.'));
        };

        for (const record of records) {
          if (!record.id) record.id = this.generateId();
          if (!record.timestamp) record.timestamp = Date.now();
          store.put(record);
          count++;
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Estimates storage usage and quota.
   * @returns {Promise<{usage: number, quota: number, percent: number}|null>}
   */
  async getStorageQuota() {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage || 0;
        const quota = estimate.quota || 0;
        const percent = quota > 0 ? Math.round((usage / quota) * 100) : 0;
        return { usage, quota, percent };
      } catch (e) {
        console.warn('Storage estimate failed:', e);
      }
    }
    return null;
  }
}

export const db = new Database();
