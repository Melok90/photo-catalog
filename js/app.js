/**
 * Photo Catalog — Main Application Controller
 * Orchestrates views, camera capture, continuous mode, gallery transitions, and backup workflows.
 */

import { db } from './db.js';
import { CameraService } from './camera.js';
import { GalleryService } from './gallery.js';
import { BackupService } from './backup.js';

class App {
  constructor() {
    this.mode = 'single'; // 'single' | 'continuous'
    this.isCapturing = false;
    this.isSaving = false;
    this.lastCapturedData = null; // Used in single mode preview

    this.cacheDom();
    this.camera = new CameraService(this.dom.cameraVideo);
    this.gallery = new GalleryService(this.getGalleryDomElements(), () => this.switchView('camera'));

    this.init();
  }

  cacheDom() {
    this.dom = {
      // Views
      viewCamera: document.getElementById('view-camera'),
      viewGallery: document.getElementById('view-gallery'),

      // Camera View Elements
      cameraVideo: document.getElementById('camera-video'),
      cameraFlipBtn: document.getElementById('btn-camera-flip'),
      cameraModeToggle: document.getElementById('btn-mode-toggle'),
      cameraModeLabel: document.getElementById('camera-mode-label'),
      shutterBtn: document.getElementById('btn-shutter'),
      shutterRing: document.querySelector('.shutter-ring'),
      openGalleryBtn: document.getElementById('btn-open-gallery'),
      shutterBadgeCount: document.getElementById('shutter-badge-count'),
      cameraFlashEffect: document.getElementById('camera-flash-overlay'),
      cameraErrorBanner: document.getElementById('camera-error-banner'),
      cameraErrorText: document.getElementById('camera-error-text'),
      cameraRetryBtn: document.getElementById('btn-camera-retry'),

      // Single Mode Preview Modal
      previewModal: document.getElementById('preview-modal'),
      previewImage: document.getElementById('preview-image'),
      previewRetakeBtn: document.getElementById('btn-preview-retake'),
      previewSaveBtn: document.getElementById('btn-preview-save'),
      previewSpinner: document.getElementById('preview-save-spinner'),

      // Gallery View Elements
      closeGalleryBtn: document.getElementById('btn-close-gallery'),
      galleryGrid: document.getElementById('gallery-grid'),
      galleryEmptyState: document.getElementById('gallery-empty-state'),
      galleryStartPhotoBtn: document.getElementById('btn-gallery-start-photo'),
      galleryTotalCount: document.getElementById('gallery-total-count'),
      storageBarContainer: document.getElementById('storage-bar-container'),
      btnBackup: document.getElementById('btn-backup'),
      btnImport: document.getElementById('btn-import'),
      fileImportInput: document.getElementById('file-import-input'),

      // Lightbox Elements
      lightboxModal: document.getElementById('lightbox-modal'),
      lightboxBackdrop: document.getElementById('lightbox-backdrop'),
      lightboxImageContainer: document.getElementById('lightbox-image-container'),
      lightboxImg: document.getElementById('lightbox-img'),
      lightboxSpinner: document.getElementById('lightbox-spinner'),
      lightboxCloseBtn: document.getElementById('btn-lightbox-close'),
      lightboxDeleteBtn: document.getElementById('btn-lightbox-delete'),
      lightboxDownloadBtn: document.getElementById('btn-lightbox-download'),
      lightboxPrevBtn: document.getElementById('btn-lightbox-prev'),
      lightboxNextBtn: document.getElementById('btn-lightbox-next'),
      lightboxDate: document.getElementById('lightbox-date'),
      lightboxSpecs: document.getElementById('lightbox-specs'),
      lightboxIndexBadge: document.getElementById('lightbox-index-badge'),

      // Export Modal
      exportModal: document.getElementById('export-modal'),
      exportModalClose: document.getElementById('btn-export-close'),
      exportZipBtn: document.getElementById('btn-export-zip'),
      exportJsonBtn: document.getElementById('btn-export-json'),
      exportProgress: document.getElementById('export-progress'),

      // Toast Notification
      toast: document.getElementById('toast'),
    };
  }

  getGalleryDomElements() {
    return {
      galleryGrid: this.dom.galleryGrid,
      galleryEmptyState: this.dom.galleryEmptyState,
      galleryTotalCount: this.dom.galleryTotalCount,
      storageBarContainer: this.dom.storageBarContainer,
      shutterBadgeCount: this.dom.shutterBadgeCount,
      lightboxModal: this.dom.lightboxModal,
      lightboxBackdrop: this.dom.lightboxBackdrop,
      lightboxImageContainer: this.dom.lightboxImageContainer,
      lightboxImg: this.dom.lightboxImg,
      lightboxSpinner: this.dom.lightboxSpinner,
      lightboxCloseBtn: this.dom.lightboxCloseBtn,
      lightboxDeleteBtn: this.dom.lightboxDeleteBtn,
      lightboxDownloadBtn: this.dom.lightboxDownloadBtn,
      lightboxPrevBtn: this.dom.lightboxPrevBtn,
      lightboxNextBtn: this.dom.lightboxNextBtn,
      lightboxDate: this.dom.lightboxDate,
      lightboxSpecs: this.dom.lightboxSpecs,
      lightboxIndexBadge: this.dom.lightboxIndexBadge,
    };
  }

  async init() {
    this.bindEvents();
    this.registerServiceWorker();
    await this.updateTotalCountBadge();

    // Start camera stream on initial load
    await this.startCamera();
  }

  bindEvents() {
    // Shutter Click
    this.dom.shutterBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.handleShutterClick();
    });

    // Camera controls
    this.dom.cameraFlipBtn.addEventListener('click', () => this.handleFlipCamera());
    this.dom.cameraModeToggle.addEventListener('click', () => this.toggleShootingMode());
    this.dom.cameraRetryBtn.addEventListener('click', () => this.startCamera());

    // Navigation
    this.dom.openGalleryBtn.addEventListener('click', () => this.switchView('gallery'));
    this.dom.closeGalleryBtn.addEventListener('click', () => this.switchView('camera'));
    this.dom.galleryStartPhotoBtn?.addEventListener('click', () => this.switchView('camera'));

    // Single preview actions
    this.dom.previewRetakeBtn.addEventListener('click', () => this.handlePreviewRetake());
    this.dom.previewSaveBtn.addEventListener('click', () => this.handlePreviewSave());

    // Backup & Import
    this.dom.btnBackup.addEventListener('click', () => this.openExportModal());
    this.dom.exportModalClose.addEventListener('click', () => this.closeExportModal());
    this.dom.exportZipBtn.addEventListener('click', () => this.handleExport('zip'));
    this.dom.exportJsonBtn.addEventListener('click', () => this.handleExport('json'));

    this.dom.btnImport.addEventListener('click', () => this.dom.fileImportInput.click());
    this.dom.fileImportInput.addEventListener('change', (e) => this.handleFileImport(e));

    // Handle visibility change (pause camera when app minimized, resume when opened)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.camera.stop();
      } else {
        if (this.dom.viewCamera.classList.contains('active')) {
          this.startCamera();
        }
      }
    });
  }

  async startCamera() {
    this.hideCameraError();
    try {
      await this.camera.start();
      // Hide flip button if only 1 camera detected
      const cameras = this.camera.availableCameras;
      if (cameras.length <= 1) {
        this.dom.cameraFlipBtn.style.display = 'none';
      } else {
        this.dom.cameraFlipBtn.style.display = 'inline-flex';
      }
    } catch (err) {
      this.showCameraError(err.message || 'Ошибка запуска камеры.');
    }
  }

  async handleFlipCamera() {
    try {
      this.dom.cameraFlipBtn.classList.add('rotating');
      await this.camera.switchCamera();
    } catch (err) {
      this.showToast(err.message || 'Не удалось переключить камеру.', 'error');
    } finally {
      this.dom.cameraFlipBtn.classList.remove('rotating');
    }
  }

  toggleShootingMode() {
    if (this.mode === 'single') {
      this.mode = 'continuous';
      this.dom.cameraModeLabel.textContent = 'Серия';
      this.dom.cameraModeToggle.classList.add('mode-continuous');
      this.showToast('Режим непрерывной съёмки включён');
    } else {
      this.mode = 'single';
      this.dom.cameraModeLabel.textContent = 'Одиночный';
      this.dom.cameraModeToggle.classList.remove('mode-continuous');
      this.showToast('Одиночный режим с предпросмотром');
    }
  }

  async handleShutterClick() {
    if (this.isCapturing || this.isSaving) return;
    this.isCapturing = true;

    // Visual feedback
    this.triggerShutterAnimation();

    try {
      const captured = await this.camera.captureFrame();

      if (this.mode === 'single') {
        // Show preview dialog for user confirmation
        this.lastCapturedData = captured;
        this.dom.previewImage.src = captured.previewDataUrl;
        this.dom.previewModal.classList.add('active');
        this.dom.previewModal.setAttribute('aria-hidden', 'false');
      } else {
        // Continuous mode: save instantly and stay in camera
        await this.savePhotoRecord(captured);
      }
    } catch (err) {
      console.error('Capture error:', err);
      this.showToast(err.message || 'Ошибка съёмки.', 'error');
    } finally {
      this.isCapturing = false;
    }
  }

  handlePreviewRetake() {
    this.dom.previewModal.classList.remove('active');
    this.dom.previewModal.setAttribute('aria-hidden', 'true');
    this.lastCapturedData = null;
    this.dom.previewImage.src = '';
  }

  async handlePreviewSave() {
    if (!this.lastCapturedData || this.isSaving) return;
    this.isSaving = true;
    this.dom.previewSaveBtn.disabled = true;
    this.dom.previewSpinner.style.display = 'inline-block';

    try {
      await this.savePhotoRecord(this.lastCapturedData);
      this.handlePreviewRetake(); // close preview modal
    } catch (err) {
      this.showToast(err.message || 'Ошибка сохранения.', 'error');
    } finally {
      this.isSaving = false;
      this.dom.previewSaveBtn.disabled = false;
      this.dom.previewSpinner.style.display = 'none';
    }
  }

  async savePhotoRecord(captured) {
    try {
      await db.savePhoto({
        originalBlob: captured.originalBlob,
        thumbnailBlob: captured.thumbnailBlob,
        width: captured.width,
        height: captured.height,
        timestamp: Date.now(),
      });

      // Update counters & badges
      await this.updateTotalCountBadge();
      this.triggerHaptic();

      if (this.mode === 'continuous') {
        this.showToast('Фото добавлено в картотеку', 'success', 1200);
      } else {
        this.showToast('Фотография успешно сохранена', 'success', 1500);
      }
    } catch (err) {
      console.error('Save failed:', err);
      throw err;
    }
  }

  triggerShutterAnimation() {
    // White screen flash
    this.dom.cameraFlashEffect.classList.remove('flash');
    void this.dom.cameraFlashEffect.offsetWidth; // trigger reflow
    this.dom.cameraFlashEffect.classList.add('flash');

    // Button pulse
    this.dom.shutterBtn.classList.add('shutter-pressed');
    setTimeout(() => {
      this.dom.shutterBtn.classList.remove('shutter-pressed');
    }, 180);
  }

  triggerHaptic() {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate([25, 20]);
      } catch (e) {}
    }
  }

  async updateTotalCountBadge() {
    const count = await db.getPhotoCount();
    if (this.dom.shutterBadgeCount) {
      this.dom.shutterBadgeCount.textContent = count > 99 ? '99+' : String(count);
      this.dom.shutterBadgeCount.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  }

  async switchView(viewName) {
    if (viewName === 'gallery') {
      this.camera.stop();
      this.dom.viewCamera.classList.remove('active');
      this.dom.viewGallery.classList.add('active');
      await this.gallery.render();
    } else {
      this.dom.viewGallery.classList.remove('active');
      this.dom.viewCamera.classList.add('active');
      await this.startCamera();
      await this.updateTotalCountBadge();
    }
  }

  showCameraError(message) {
    this.dom.cameraErrorText.textContent = message;
    this.dom.cameraErrorBanner.style.display = 'flex';
  }

  hideCameraError() {
    this.dom.cameraErrorBanner.style.display = 'none';
  }

  openExportModal() {
    this.dom.exportModal.classList.add('active');
    this.dom.exportModal.setAttribute('aria-hidden', 'false');
    this.dom.exportProgress.textContent = '';
  }

  closeExportModal() {
    this.dom.exportModal.classList.remove('active');
    this.dom.exportModal.setAttribute('aria-hidden', 'true');
  }

  async handleExport(type) {
    this.dom.exportZipBtn.disabled = true;
    this.dom.exportJsonBtn.disabled = true;
    this.dom.exportProgress.textContent = 'Подготовка файлов архива...';

    try {
      const onProgress = (curr, total) => {
        this.dom.exportProgress.textContent = `Обработка снимков: ${curr} из ${total}...`;
      };

      let count = 0;
      if (type === 'zip') {
        count = await BackupService.exportZip(onProgress);
      } else {
        count = await BackupService.exportJson(onProgress);
      }

      this.dom.exportProgress.textContent = `Экспорт завершён: ${count} фото!`;
      setTimeout(() => {
        this.closeExportModal();
        this.showToast(`Экспортировано ${count} фото`, 'success');
      }, 1200);
    } catch (err) {
      this.dom.exportProgress.textContent = `Ошибка: ${err.message}`;
      this.showToast(err.message, 'error');
    } finally {
      this.dom.exportZipBtn.disabled = false;
      this.dom.exportJsonBtn.disabled = false;
    }
  }

  async handleFileImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const confirmImport = confirm(`Восстановить картотеку из файла «${file.name}»? Новые фотографии будут добавлены к текущим.`);
    if (!confirmImport) {
      e.target.value = '';
      return;
    }

    this.showToast('Импорт фотографий, подождите...', 'info', 5000);

    try {
      const importedCount = await BackupService.importBackup(file, (curr, total) => {
        if (curr % 5 === 0 || curr === total) {
          this.showToast(`Импорт: ${curr} из ${total}...`, 'info', 2000);
        }
      });

      this.showToast(`Успешно импортировано ${importedCount} фото!`, 'success');
      await this.gallery.render();
      await this.updateTotalCountBadge();
    } catch (err) {
      alert(`Ошибка импорта: ${err.message}`);
      this.showToast('Ошибка при восстановлении данных', 'error');
    } finally {
      e.target.value = '';
    }
  }

  showToast(message, type = 'info', duration = 2200) {
    if (!this.dom.toast) return;
    this.dom.toast.textContent = message;
    this.dom.toast.className = `toast toast-${type} active`;

    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.dom.toast.classList.remove('active');
    }, duration);
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then((reg) => {
            console.log('ServiceWorker registered with scope:', reg.scope);
          })
          .catch((err) => {
            console.warn('ServiceWorker registration failed:', err);
          });
      });
    }
  }
}

// Initialize on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  window.photoCatalogApp = new App();
});
