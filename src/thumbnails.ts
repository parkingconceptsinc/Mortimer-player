export function captureVideoFrame(url: string): Promise<{ image: Blob | null; duration?: number }> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    const finish = (image: Blob | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;
      video.removeAttribute("src");
      video.load();
      resolve({ image, duration });
    };
    const timer = window.setTimeout(() => finish(null), 10000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadedmetadata = () => {
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      video.currentTime = d > 2 ? Math.min(d * 0.1, 30) : 0;
    };
    video.onseeked = () => {
      if (!video.videoWidth) return finish(null);
      const canvas = document.createElement("canvas");
      canvas.width = 384;
      canvas.height = Math.round((384 * video.videoHeight) / video.videoWidth);
      const ctx = canvas.getContext("2d");
      if (!ctx) return finish(null);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => finish(blob), "image/jpeg", 0.78);
    };
    video.onerror = () => finish(null);
    video.src = url;
  });
}
