export function captureVideoFrame(url: string): Promise<{ image: Blob | null; duration?: number }> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    let frameQueued = false;
    let sampleTime = 0;

    const finish = (image: Blob | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;
      resolve({ image, duration });
    };

    const renderFrame = () => {
      if (settled) return;
      if (!video.videoWidth || !video.videoHeight) return finish(null);
      const canvas = document.createElement("canvas");
      canvas.width = 384;
      canvas.height = Math.max(1, Math.round((384 * video.videoHeight) / video.videoWidth));
      const ctx = canvas.getContext("2d");
      if (!ctx) return finish(null);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => finish(blob), "image/jpeg", 0.78);
    };

    const scheduleFrame = () => {
      if (settled || frameQueued) return;
      frameQueued = true;
      requestAnimationFrame(() => {
        frameQueued = false;
        renderFrame();
      });
    };

    const timer = window.setTimeout(() => finish(null), 10000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadedmetadata = () => {
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      sampleTime = d > 2 ? Math.min(d * 0.1, 30) : 0;
      if (sampleTime > 0) video.currentTime = sampleTime;
      else scheduleFrame();
    };
    video.onseeked = () => {
      if (sampleTime <= 0 || Math.abs(video.currentTime - sampleTime) < 0.25) scheduleFrame();
    };
    video.onerror = () => finish(null);
    video.src = url;
  });
}
