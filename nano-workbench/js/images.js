import { IMAGE_LIMITS } from './config.js';
import { id } from './utils.js';

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('画像の変換に失敗しました。')), type, quality);
  });
}

function targetSize(width, height, maxEdge) {
  const edge = Math.max(width, height);
  if (edge <= maxEdge) return { width, height };
  const scale = maxEdge / edge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function validateImage(file, settings, currentCount = 0) {
  if (!IMAGE_LIMITS.supported.has(file.type)) throw new Error('PNG / JPEG / WebP の画像を選択してください。');
  if (file.size > IMAGE_LIMITS.maxOriginalBytes) throw new Error('1画像は20MB以下にしてください。');
  if (currentCount >= settings.maxImages) throw new Error(`1回に添付できる画像は${settings.maxImages}枚までです。`);
}

export async function normalizeImage(file, settings) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const screenshotLike = file.type === 'image/png' || /screen|screenshot|capture|スクリーン/i.test(file.name || '');
  const maxEdge = screenshotLike ? settings.screenshotMaxEdge : settings.photoMaxEdge;
  const size = targetSize(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close?.();

  const outputType = file.type === 'image/png' ? 'image/png' : 'image/webp';
  const normalizedBlob = await canvasBlob(canvas, outputType, settings.imageQuality);

  const thumbSize = targetSize(size.width, size.height, 360);
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = thumbSize.width;
  thumbCanvas.height = thumbSize.height;
  thumbCanvas.getContext('2d').drawImage(canvas, 0, 0, thumbSize.width, thumbSize.height);
  const thumbnailBlob = await canvasBlob(thumbCanvas, 'image/webp', 0.78);

  return {
    id: id('att'), kind: 'image', name: file.name || 'pasted-image',
    mimeType: normalizedBlob.type, width: size.width, height: size.height,
    byteSize: normalizedBlob.size, originalByteSize: file.size,
    normalizedBlob, thumbnailBlob, injectedInCurrentSession: false,
    sessionState: 'stored-only', createdAt: Date.now(),
  };
}

export function totalNormalizedBytes(attachments) {
  return attachments.reduce((sum, x) => sum + (x.byteSize || x.normalizedBlob?.size || 0), 0);
}
