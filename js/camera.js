/**
 * Photo Catalog — Camera Module
 * Handles MediaDevices stream lifecycle, camera switching, resolution setup,
 * high-res capture to Canvas and thumbnail generation.
 */

export class CameraService {
  constructor(videoElement) {
    this.video = videoElement;
    this.stream = null;
    this.currentFacingMode = 'environment'; // 'environment' (back) or 'user' (front)
    this.availableCameras = [];
    this.isStarting = false;
  }

  /**
   * Checks if camera API is supported in the current environment.
   */
  isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /**
   * Discovers video input devices.
   */
  async enumerateCameras() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return [];
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.availableCameras = devices.filter(d => d.kind === 'videoinput');
      return this.availableCameras;
    } catch (e) {
      console.warn('enumerateDevices error:', e);
      return [];
    }
  }

  /**
   * Starts the camera stream.
   * @param {string} [facingMode='environment']
   * @returns {Promise<MediaStream>}
   */
  async start(facingMode = this.currentFacingMode) {
    if (this.isStarting) return;
    this.isStarting = true;

    try {
      if (!this.isSupported()) {
        throw new Error('Ваш браузер не поддерживает доступ к камере (MediaDevices API). Убедитесь, что сайт открыт по HTTPS или localhost.');
      }

      // Stop existing stream if running
      this.stop();

      this.currentFacingMode = facingMode;

      // iOS Safari-friendly high resolution constraints
      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 3840, min: 1280 },
          height: { ideal: 2160, min: 720 },
        }
      };

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        // Fallback with simpler constraints if high-res failed
        console.warn('Fallback to basic video constraints due to:', err);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: facingMode }
        });
      }

      this.stream = stream;
      this.video.srcObject = stream;
      this.video.setAttribute('playsinline', 'true');
      this.video.setAttribute('webkit-playsinline', 'true');
      this.video.muted = true;

      await new Promise((resolve) => {
        if (this.video.readyState >= 2) {
          resolve();
        } else {
          this.video.onloadeddata = () => resolve();
        }
      });

      await this.video.play();
      await this.enumerateCameras();

      return stream;
    } catch (error) {
      console.error('Camera start failed:', error);
      let message = 'Не удалось получить доступ к камере.';
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        message = 'Доступ к камере заблокирован. Разрешите использование камеры в настройках Safari для этого сайта.';
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        message = 'Камера на данном устройстве не найдена.';
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        message = 'Камера уже используется другим приложением.';
      } else if (error.name === 'OverconstrainedError') {
        message = 'Запрошенные параметры камеры не поддерживаются устройством.';
      } else if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        message = 'Камера работает только через защищённое соединение (HTTPS) или localhost.';
      }
      const customError = new Error(message);
      customError.originalError = error;
      throw customError;
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Toggles between front and rear cameras.
   */
  async switchCamera() {
    const nextMode = this.currentFacingMode === 'environment' ? 'user' : 'environment';
    return this.start(nextMode);
  }

  /**
   * Stops all active tracks.
   */
  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }

  /**
   * Captures the current frame as high-res original Blob and thumbnail Blob.
   * @returns {Promise<{originalBlob: Blob, thumbnailBlob: Blob, width: number, height: number, dataUrl: string}>}
   */
  async captureFrame() {
    if (!this.video || this.video.readyState < 2) {
      throw new Error('Камера ещё не готова к съёмке.');
    }

    const width = this.video.videoWidth || 1920;
    const height = this.video.videoHeight || 1080;

    // 1. Render original full-resolution canvas
    const origCanvas = document.createElement('canvas');
    origCanvas.width = width;
    origCanvas.height = height;
    const origCtx = origCanvas.getContext('2d', { alpha: false, desynchronized: true });

    // Handle selfie mirroring if front camera
    if (this.currentFacingMode === 'user') {
      origCtx.translate(width, 0);
      origCtx.scale(-1, 1);
    }
    origCtx.drawImage(this.video, 0, 0, width, height);

    // 2. Generate original Blob (high quality JPEG 0.94)
    const originalBlob = await new Promise((resolve, reject) => {
      origCanvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Сбой создания оригинального файла снимка.'))),
        'image/jpeg',
        0.94
      );
    });

    // 3. Generate thumbnail (max 360x360 for high DPI display)
    const maxThumbDim = 360;
    let thumbW = width;
    let thumbH = height;
    if (thumbW > maxThumbDim || thumbH > maxThumbDim) {
      if (thumbW > thumbH) {
        thumbH = Math.round((thumbH * maxThumbDim) / thumbW);
        thumbW = maxThumbDim;
      } else {
        thumbW = Math.round((thumbW * maxThumbDim) / thumbH);
        thumbH = maxThumbDim;
      }
    }

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = thumbW;
    thumbCanvas.height = thumbH;
    const thumbCtx = thumbCanvas.getContext('2d', { alpha: false });
    thumbCtx.imageSmoothingEnabled = true;
    thumbCtx.imageSmoothingQuality = 'high';
    thumbCtx.drawImage(origCanvas, 0, 0, thumbW, thumbH);

    const thumbnailBlob = await new Promise((resolve) => {
      thumbCanvas.toBlob(
        (blob) => resolve(blob || originalBlob),
        'image/jpeg',
        0.82
      );
    });

    // Generate preview data URL for instant review (low latency)
    const previewDataUrl = origCanvas.toDataURL('image/jpeg', 0.85);

    return {
      originalBlob,
      thumbnailBlob,
      width,
      height,
      previewDataUrl
    };
  }
}
