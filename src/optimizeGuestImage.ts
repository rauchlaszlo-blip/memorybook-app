const MAX_LONG_EDGE = 2480;
const A5_PRINT_WARNING_LONG_EDGE = 1240;
const TARGET_FILE_SIZE = 1_500_000;
const WEBP_QUALITIES = [0.88, 0.8, 0.72, 0.64];

export type OptimizedGuestImage = {
  dataUrl: string;
  width: number;
  height: number;
  originalBytes: number;
  optimizedBytes: number;
  mayBeLowResolutionForA5: boolean;
};

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('IMAGE_READ_FAILED'));
  reader.readAsDataURL(blob);
});

const loadImage = (file: File) => new Promise<HTMLImageElement>((resolve, reject) => {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(objectUrl);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error('IMAGE_DECODE_FAILED'));
  };
  image.src = objectUrl;
});

const canvasToBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('IMAGE_ENCODE_FAILED')),
      'image/webp',
      quality
    );
  });

export async function optimizeGuestImage(file: File): Promise<OptimizedGuestImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('UNSUPPORTED_IMAGE_TYPE');
  }

  const image = await loadImage(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  if (!sourceWidth || !sourceHeight) {
    throw new Error('IMAGE_DECODE_FAILED');
  }

  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('IMAGE_ENCODE_FAILED');

  context.drawImage(image, 0, 0, width, height);

  let optimizedBlob: Blob | null = null;
  for (const quality of WEBP_QUALITIES) {
    optimizedBlob = await canvasToBlob(canvas, quality);
    if (optimizedBlob.size <= TARGET_FILE_SIZE) break;
  }

  if (!optimizedBlob) throw new Error('IMAGE_ENCODE_FAILED');

  return {
    dataUrl: await blobToDataUrl(optimizedBlob),
    width,
    height,
    originalBytes: file.size,
    optimizedBytes: optimizedBlob.size,
    mayBeLowResolutionForA5: Math.max(sourceWidth, sourceHeight) < A5_PRINT_WARNING_LONG_EDGE,
  };
}
