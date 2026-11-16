/**
 * Photo Catalog — Backup & Restore Module
 * Handles exporting all photos as standard ZIP (with Store method) or JSON backup,
 * and restoring/importing backup files back into IndexedDB.
 */

import { db } from './db.js';

// Pre-computed CRC32 table for ZIP compliance
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

function calculateCRC32(bytes) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

/**
 * Encodes string to UTF-8 Uint8Array.
 */
function encodeUTF8(str) {
  return new TextEncoder().encode(str);
}

/**
 * Decodes UTF-8 Uint8Array to string.
 */
function decodeUTF8(bytes) {
  return new TextDecoder().decode(bytes);
}

/**
 * Converts a Date object to MS-DOS date and time (required for ZIP headers).
 */
function toDosDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const time =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const dateNum =
    (((d.getFullYear() - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0x0f) << 5) |
    (d.getDate() & 0x1f);
  return { time, date: dateNum };
}

export class BackupService {
  /**
   * Builds and downloads a standard ZIP archive containing all original photos
   * and a catalog.json metadata index.
   * @param {Function} [onProgress] - Callback (current, total)
   */
  static async exportZip(onProgress) {
    const photos = await db.getAllPhotos(true);
    if (!photos || photos.length === 0) {
      throw new Error('Картотека пуста. Нечего экспортировать.');
    }

    const files = [];
    const catalogMeta = [];

    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      if (onProgress) onProgress(i + 1, photos.length);

      const d = new Date(p.timestamp || Date.now());
      const pad = (n) => String(n).padStart(2, '0');
      const dateStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      const filename = `photos/photo_${dateStr}_${p.id.substring(0, 8)}.jpg`;

      let fileData;
      if (p.originalBlob instanceof Blob) {
        const buffer = await p.originalBlob.arrayBuffer();
        fileData = new Uint8Array(buffer);
      } else {
        fileData = new Uint8Array(0);
      }

      files.push({
        name: filename,
        data: fileData,
        date: d,
      });

      catalogMeta.push({
        id: p.id,
        timestamp: p.timestamp,
        createdAt: p.createdAt,
        width: p.width,
        height: p.height,
        sizeBytes: p.sizeBytes,
        filename,
      });
    }

    // Add metadata JSON
    const metaString = JSON.stringify({
      appName: 'Photo Catalog PWA',
      exportDate: new Date().toISOString(),
      count: catalogMeta.length,
      photos: catalogMeta,
    }, null, 2);

    files.push({
      name: 'catalog.json',
      data: encodeUTF8(metaString),
      date: new Date(),
    });

    // Assemble ZIP package
    const zipBlob = this._createZipBlob(files);
    const dateStamp = new Date().toISOString().slice(0, 10);
    this._triggerDownload(zipBlob, `photo_catalog_backup_${dateStamp}.zip`);
    return photos.length;
  }

  /**
   * Internal helper to create standard ZIP file in memory (Store method 0).
   */
  static _createZipBlob(files) {
    const localHeaders = [];
    const centralEntries = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = encodeUTF8(file.name);
      const crc = calculateCRC32(file.data);
      const size = file.data.length;
      const { time, date } = toDosDateTime(file.date || new Date());

      // Local Header (30 bytes + name length)
      const lh = new Uint8Array(30 + nameBytes.length);
      const lhView = new DataView(lh.buffer);

      lhView.setUint32(0, 0x04034b50, true); // Local header signature
      lhView.setUint16(4, 20, true);         // Version needed: 2.0
      lhView.setUint16(6, 0x0800, true);     // General purpose bit flag (UTF-8)
      lhView.setUint16(8, 0, true);          // Compression: Store (0)
      lhView.setUint16(10, time, true);
      lhView.setUint16(12, date, true);
      lhView.setUint32(14, crc, true);
      lhView.setUint32(18, size, true);      // Compressed size
      lhView.setUint32(22, size, true);      // Uncompressed size
      lhView.setUint16(26, nameBytes.length, true);
      lhView.setUint16(28, 0, true);         // Extra field length
      lh.set(nameBytes, 30);

      localHeaders.push(lh);
      localHeaders.push(file.data);

      // Central Directory Entry (46 bytes + name length)
      const cd = new Uint8Array(46 + nameBytes.length);
      const cdView = new DataView(cd.buffer);

      cdView.setUint32(0, 0x02014b50, true); // Central header signature
      cdView.setUint16(4, 20, true);         // Version made by
      cdView.setUint16(6, 20, true);         // Version needed
      cdView.setUint16(8, 0x0800, true);     // Flags (UTF-8)
      cdView.setUint16(10, 0, true);         // Compression: 0
      cdView.setUint16(12, time, true);
      cdView.setUint16(14, date, true);
      cdView.setUint32(16, crc, true);
      cdView.setUint32(20, size, true);
      cdView.setUint32(24, size, true);
      cdView.setUint16(28, nameBytes.length, true);
      cdView.setUint16(30, 0, true);         // Extra length
      cdView.setUint16(32, 0, true);         // Comment length
      cdView.setUint16(34, 0, true);         // Disk number start
      cdView.setUint16(36, 0, true);         // Internal attributes
      cdView.setUint32(38, 0, true);         // External attributes
      cdView.setUint32(42, offset, true);    // Relative offset of local header
      cd.set(nameBytes, 46);

      centralEntries.push(cd);
      offset += lh.length + file.data.length;
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (const cd of centralEntries) {
      cdSize += cd.length;
    }

    // End of Central Directory (22 bytes)
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
    eocdView.setUint16(4, 0, true);          // Disk number
    eocdView.setUint16(6, 0, true);          // Disk with CD
    eocdView.setUint16(8, files.length, true);  // Entries on disk
    eocdView.setUint16(10, files.length, true); // Total entries
    eocdView.setUint32(12, cdSize, true);       // Size of CD
    eocdView.setUint32(16, cdOffset, true);     // Offset of CD
    eocdView.setUint16(20, 0, true);            // Comment length

    return new Blob([...localHeaders, ...centralEntries, eocd], { type: 'application/zip' });
  }

  /**
   * Exports full catalog as portable JSON backup (metadata + base64 photos).
   */
  static async exportJson(onProgress) {
    const photos = await db.getAllPhotos(true);
    if (!photos || photos.length === 0) {
      throw new Error('Картотека пуста. Нечего экспортировать.');
    }

    const exportItems = [];
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      if (onProgress) onProgress(i + 1, photos.length);

      let base64Original = '';
      if (p.originalBlob instanceof Blob) {
        base64Original = await this._blobToBase64(p.originalBlob);
      }

      exportItems.push({
        id: p.id,
        timestamp: p.timestamp,
        createdAt: p.createdAt,
        width: p.width,
        height: p.height,
        sizeBytes: p.sizeBytes,
        originalData: base64Original,
      });
    }

    const payload = {
      app: 'Photo Catalog PWA',
      version: 1,
      exportedAt: new Date().toISOString(),
      count: exportItems.length,
      items: exportItems,
    };

    const jsonBlob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const dateStamp = new Date().toISOString().slice(0, 10);
    this._triggerDownload(jsonBlob, `photo_catalog_backup_${dateStamp}.json`);
    return exportItems.length;
  }

  /**
   * Imports a backup file (.zip or .json) and restores photos into IndexedDB.
   * @param {File} file
   * @param {Function} [onProgress] - Callback (current, total)
   * @returns {Promise<number>} Count of imported items
   */
  static async importBackup(file, onProgress) {
    if (!file) throw new Error('Файл не выбран.');

    const name = file.name.toLowerCase();

    if (name.endsWith('.json')) {
      return this._importFromJson(file, onProgress);
    } else if (name.endsWith('.zip')) {
      return this._importFromZip(file, onProgress);
    } else {
      throw new Error('Неподдерживаемый формат. Выберите .zip или .json файл резервной копии.');
    }
  }

  static async _importFromJson(file, onProgress) {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('Не удалось прочитать JSON файл. Файл повреждён.');
    }

    const items = data.items || data.photos || [];
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('В файле резервной копии не найдено записей фотографий.');
    }

    const recordsToInsert = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (onProgress) onProgress(i + 1, items.length);

      let originalBlob;
      if (it.originalData) {
        originalBlob = await this._base64ToBlob(it.originalData, 'image/jpeg');
      } else {
        continue;
      }

      // Generate thumbnail
      const thumbnailBlob = await this._createThumbnailFromBlob(originalBlob);

      recordsToInsert.push({
        id: it.id || db.generateId(),
        timestamp: it.timestamp || Date.now(),
        createdAt: it.createdAt || new Date(it.timestamp || Date.now()).toISOString(),
        width: it.width || 0,
        height: it.height || 0,
        sizeBytes: originalBlob.size,
        originalBlob,
        thumbnailBlob,
      });
    }

    return await db.batchInsertPhotos(recordsToInsert);
  }

  static async _importFromZip(file, onProgress) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    // Parse ZIP local headers
    const extractedFiles = new Map();
    let pos = 0;

    while (pos < bytes.length - 30) {
      const sig = view.getUint32(pos, true);
      if (sig === 0x04034b50) { // Local File Header
        const compression = view.getUint16(pos + 8, true);
        const compSize = view.getUint32(pos + 18, true);
        const uncompSize = view.getUint32(pos + 22, true);
        const nameLen = view.getUint16(pos + 26, true);
        const extraLen = view.getUint16(pos + 28, true);

        const nameBytes = bytes.subarray(pos + 30, pos + 30 + nameLen);
        const fileName = decodeUTF8(nameBytes);
        const dataStart = pos + 30 + nameLen + extraLen;
        const fileData = bytes.subarray(dataStart, dataStart + uncompSize);

        extractedFiles.set(fileName, fileData);
        pos = dataStart + compSize;
      } else if (sig === 0x02014b50 || sig === 0x06054b50) {
        // Reached central directory
        break;
      } else {
        pos++;
      }
    }

    // Check for catalog.json metadata
    let metadataList = null;
    if (extractedFiles.has('catalog.json')) {
      try {
        const metaJson = JSON.parse(decodeUTF8(extractedFiles.get('catalog.json')));
        metadataList = metaJson.photos || [];
      } catch (e) {
        console.warn('Could not parse catalog.json inside ZIP:', e);
      }
    }

    const recordsToInsert = [];
    const photoFiles = Array.from(extractedFiles.entries()).filter(([name]) =>
      name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png')
    );

    if (photoFiles.length === 0) {
      throw new Error('В архиве не найдено изображений.');
    }

    for (let i = 0; i < photoFiles.length; i++) {
      const [fileName, fileBytes] = photoFiles[i];
      if (onProgress) onProgress(i + 1, photoFiles.length);

      const originalBlob = new Blob([fileBytes], { type: 'image/jpeg' });
      const thumbnailBlob = await this._createThumbnailFromBlob(originalBlob);

      // Find meta if available
      const matchedMeta = metadataList ? metadataList.find(m => m.filename === fileName) : null;

      recordsToInsert.push({
        id: matchedMeta?.id || db.generateId(),
        timestamp: matchedMeta?.timestamp || Date.now(),
        createdAt: matchedMeta?.createdAt || new Date().toISOString(),
        width: matchedMeta?.width || 0,
        height: matchedMeta?.height || 0,
        sizeBytes: originalBlob.size,
        originalBlob,
        thumbnailBlob,
      });
    }

    return await db.batchInsertPhotos(recordsToInsert);
  }

  static async _createThumbnailFromBlob(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const maxThumbDim = 360;
        let thumbW = img.naturalWidth || 360;
        let thumbH = img.naturalHeight || 360;
        if (thumbW > maxThumbDim || thumbH > maxThumbDim) {
          if (thumbW > thumbH) {
            thumbH = Math.round((thumbH * maxThumbDim) / thumbW);
            thumbW = maxThumbDim;
          } else {
            thumbW = Math.round((thumbW * maxThumbDim) / thumbH);
            thumbH = maxThumbDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = thumbW;
        canvas.height = thumbH;
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.drawImage(img, 0, 0, thumbW, thumbH);
        canvas.toBlob((thumbBlob) => resolve(thumbBlob || blob), 'image/jpeg', 0.82);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(blob);
      };
      img.src = url;
    });
  }

  static _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  static async _base64ToBlob(dataUrl, defaultType = 'image/jpeg') {
    const res = await fetch(dataUrl);
    return await res.blob();
  }

  static _triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }
}
