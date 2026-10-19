const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeBase64(bytes: Uint8Array): string {
  let base64 = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    base64 += chars[bytes[i] >> 2];
    base64 += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
    base64 += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
    base64 += chars[bytes[i + 2] & 63];
  }
  if (len % 3 === 2) {
    base64 = base64.substring(0, base64.length - 1) + '=';
  } else if (len % 3 === 1) {
    base64 = base64.substring(0, base64.length - 2) + '==';
  }
  return base64;
}

export function generateBMPb64(
  width: number,
  height: number,
  pixelFunc: (x: number, y: number) => { r: number; g: number; b: number }
): string {
  const rowBytes = (width * 3 + 3) & ~3;
  const pixelDataSize = rowBytes * height;
  const fileSize = 54 + pixelDataSize;
  const buffer = new Uint8Array(fileSize);

  // BMP Header
  buffer[0] = 0x42; // B
  buffer[1] = 0x4d; // M
  buffer[2] = fileSize & 0xff;
  buffer[3] = (fileSize >> 8) & 0xff;
  buffer[4] = (fileSize >> 16) & 0xff;
  buffer[5] = (fileSize >> 24) & 0xff;
  buffer[10] = 54; // Pixel data offset

  // DIB Header
  buffer[14] = 40; // Header size
  buffer[18] = width & 0xff;
  buffer[19] = (width >> 8) & 0xff;
  buffer[22] = height & 0xff;
  buffer[23] = (height >> 8) & 0xff;
  buffer[26] = 1; // Planes
  buffer[28] = 24; // Bits per pixel

  for (let y = 0; y < height; y++) {
    // BMP is bottom-up
    const bmpY = height - 1 - y;
    let target = 54 + bmpY * rowBytes;
    for (let x = 0; x < width; x++) {
      const { r, g, b } = pixelFunc(x, y);
      buffer[target] = b;
      buffer[target + 1] = g;
      buffer[target + 2] = r;
      target += 3;
    }
  }

  // Optimize base64 conversion 
  return `data:image/bmp;base64,${encodeBase64(buffer)}`;
}
