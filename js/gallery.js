/**
 * Photo Catalog — Gallery View & Lightbox Module
 * Displays grid of photos, handles lightbox viewing, zooming, deletion, and downloading.
 */

import { db } from './db.js';

export class GalleryService {
  constructor(elements, onNavigateToCamera) {
    this.elements = elements;
    this.onNavigateToCamera = onNavigateToCamera;
    this.photos = [];
    this.currentPhotoIndex = -1;
    this.activeObjectUrls = new Set();
    this.currentFullUrl = null;

    this.initEvents();
  }

  initEvents() {
    // Lightbox close button & backdrop
    this.elements.lightboxCloseBtn?.addEventListener('click', () => this.closeLightbox());
    this.elements.lightboxBackdrop?.addEventListener('click', (e) => {
      if (e.target === this.elements.lightboxBackdrop || e.target === this.elements.lightboxImageContainer) {
        this.closeLightbox();
      }
    });

    // Lightbox actions
    this.elements.lightboxDeleteBtn?.addEventListener('click', () => this.confirmDeleteCurrent());
    this.elements.lightboxDownloadBtn?.addEventListener('click', () => this.downloadCurrent());

    // Navigation buttons in lightbox
    this.elements.lightboxPrevBtn?.addEventListener('click', () => this.navigateLightbox(-1));
    this.elements.lightboxNextBtn?.addEventListener('click', () => this.navigateLightbox(1));

    // Keyboard navigation (Escape, Left, Right)
    window.addEventListener('keydown', (e) => {
      if (!this.elements.lightboxModal.classList.contains('active')) return;
      if (e.key === 'Escape') this.closeLightbox();
      if (e.key === 'ArrowLeft') this.navigateLightbox(-1);
      if (e.key === 'ArrowRight') this.navigateLightbox(1);
    });

    // Touch swipe support for lightbox
    let touchStartX = 0;
    let touchEndX = 0;
    this.elements.lightboxImageContainer?.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });
    this.elements.lightboxImageContainer?.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      const diff = touchEndX - touchStartX;
      if (Math.abs(diff) > 60) {
        if (diff > 0) this.navigateLightbox(-1); // Swipe right -> prev
        else this.navigateLightbox(1);          // Swipe left -> next
      }
    }, { passive: true });
  }

  /**
   * Refreshes and renders the gallery grid.
   */
  async render() {
    this.clearUrls();
    this.photos = await db.getAllPhotos(false);
    this.updateCounters();
    this.renderStorageEstimate();

    const grid = this.elements.galleryGrid;
    const emptyState = this.elements.galleryEmptyState;

    if (!this.photos || this.photos.length === 0) {
      grid.innerHTML = '';
      grid.style.display = 'none';
      if (emptyState) emptyState.style.display = 'flex';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    grid.style.display = 'grid';
    grid.innerHTML = '';

    const fragment = document.createDocumentFragment();

    this.photos.forEach((photo, index) => {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `Фотография от ${this.formatDateTime(photo.timestamp)}`);

      let thumbUrl = '';
      if (photo.thumbnailBlob) {
        thumbUrl = URL.createObjectURL(photo.thumbnailBlob);
        this.activeObjectUrls.add(thumbUrl);
      }

      card.innerHTML = `
        <div class="gallery-card-img-wrapper">
          <img src="${thumbUrl}" alt="Снимок" loading="lazy" class="gallery-thumb" />
          <div class="gallery-card-gradient"></div>
          <span class="gallery-card-time">${this.formatTimeOnly(photo.timestamp)}</span>
        </div>
      `;

      card.addEventListener('click', () => this.openLightbox(index));
      fragment.appendChild(card);
    });

    grid.appendChild(fragment);
  }

  updateCounters() {
    const count = this.photos.length;
    if (this.elements.galleryTotalCount) {
      this.elements.galleryTotalCount.textContent = `${count} ${this.pluralizePhotos(count)}`;
    }
    if (this.elements.shutterBadgeCount) {
      this.elements.shutterBadgeCount.textContent = count > 99 ? '99+' : String(count);
      this.elements.shutterBadgeCount.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  }

  async renderStorageEstimate() {
    const quota = await db.getStorageQuota();
    if (!quota || !this.elements.storageBarContainer) return;

    const usedMb = (quota.usage / (1024 * 1024)).toFixed(1);
    const totalMb = (quota.quota / (1024 * 1024)).toFixed(0);
    const percent = Math.min(100, Math.max(1, quota.percent));

    this.elements.storageBarContainer.innerHTML = `
      <div class="storage-info">
        <span>Память устройства: ${usedMb} МБ из ~${(totalMb / 1024).toFixed(1)} ГБ</span>
        <span>${percent}%</span>
      </div>
      <div class="storage-progress-bg">
        <div class="storage-progress-fill" style="width: ${percent}%;"></div>
      </div>
    `;

    if (percent > 90) {
      this.elements.storageBarContainer.classList.add('storage-warning');
    } else {
      this.elements.storageBarContainer.classList.remove('storage-warning');
    }
  }

  /**
   * Opens the lightbox modal for a specific photo index.
   */
  async openLightbox(index) {
    if (index < 0 || index >= this.photos.length) return;
    this.currentPhotoIndex = index;
    const meta = this.photos[index];

    this.elements.lightboxModal.classList.add('active');
    this.elements.lightboxModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Show loading state for image
    this.elements.lightboxImg.style.opacity = '0.3';
    this.elements.lightboxSpinner.style.display = 'block';

    // Load full resolution record
    const fullRecord = await db.getPhotoById(meta.id);
    if (!fullRecord) {
      alert('Не удалось загрузить фотографию.');
      this.closeLightbox();
      return;
    }

    if (this.currentFullUrl) {
      URL.revokeObjectURL(this.currentFullUrl);
    }

    this.currentFullUrl = URL.createObjectURL(fullRecord.originalBlob);
    this.elements.lightboxImg.src = this.currentFullUrl;
    this.elements.lightboxImg.onload = () => {
      this.elements.lightboxImg.style.opacity = '1';
      this.elements.lightboxSpinner.style.display = 'none';
    };

    // Update metadata panel
    this.elements.lightboxDate.textContent = this.formatDateTime(fullRecord.timestamp);
    const dim = `${fullRecord.width || 0} × ${fullRecord.height || 0} px`;
    const size = this.formatBytes(fullRecord.sizeBytes);
    this.elements.lightboxSpecs.textContent = `${dim} • ${size}`;
    this.elements.lightboxIndexBadge.textContent = `${index + 1} из ${this.photos.length}`;

    // Update nav buttons visibility
    this.elements.lightboxPrevBtn.style.visibility = index > 0 ? 'visible' : 'hidden';
    this.elements.lightboxNextBtn.style.visibility = index < this.photos.length - 1 ? 'visible' : 'hidden';
  }

  navigateLightbox(direction) {
    const nextIndex = this.currentPhotoIndex + direction;
    if (nextIndex >= 0 && nextIndex < this.photos.length) {
      this.openLightbox(nextIndex);
    }
  }

  closeLightbox() {
    this.elements.lightboxModal.classList.remove('active');
    this.elements.lightboxModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (this.currentFullUrl) {
      URL.revokeObjectURL(this.currentFullUrl);
      this.currentFullUrl = null;
    }
    this.elements.lightboxImg.src = '';
    this.currentPhotoIndex = -1;
  }

  async confirmDeleteCurrent() {
    if (this.currentPhotoIndex < 0 || this.currentPhotoIndex >= this.photos.length) return;
    const photo = this.photos[this.currentPhotoIndex];

    const confirmed = confirm('Удалить эту фотографию из картотеки? Это действие нельзя отменить.');
    if (!confirmed) return;

    try {
      await db.deletePhoto(photo.id);
      this.closeLightbox();
      await this.render();
    } catch (err) {
      alert(err.message || 'Ошибка удаления фотографии.');
    }
  }

  async downloadCurrent() {
    if (this.currentPhotoIndex < 0 || this.currentPhotoIndex >= this.photos.length) return;
    const photo = this.photos[this.currentPhotoIndex];
    const fullRecord = await db.getPhotoById(photo.id);
    if (!fullRecord) return;

    const d = new Date(fullRecord.timestamp);
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const filename = `photo_${dateStr}.jpg`;

    const url = URL.createObjectURL(fullRecord.originalBlob);
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

  clearUrls() {
    this.activeObjectUrls.forEach(url => URL.revokeObjectURL(url));
    this.activeObjectUrls.clear();
  }

  formatDateTime(timestamp) {
    if (!timestamp) return 'Неизвестная дата';
    const date = new Date(timestamp);
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  formatTimeOnly(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 Б';
    const k = 1024;
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  pluralizePhotos(count) {
    const cases = [2, 0, 1, 1, 1, 2];
    const titles = ['фотография', 'фотографии', 'фотографий'];
    return titles[
      count % 100 > 4 && count % 100 < 20 ? 2 : cases[count % 10 < 5 ? count % 10 : 5]
    ];
  }
}
