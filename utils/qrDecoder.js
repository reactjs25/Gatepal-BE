const { Jimp } = require('jimp');
const jsQR = require('jsqr');
const QrCode = require('qrcode-reader');

const extractBase64Payload = (input) => {
  const raw = (input || '').toString().trim();
  if (!raw) {
    throw new Error('QR code image is required');
  }

  const match = raw.match(/^data:image\/([a-z0-9.+-]+);base64,/i);
  let payload = match ? raw.substring(raw.indexOf(',') + 1) : raw;

  
  payload = payload.replace(/ /g, '+').replace(/\s+/g, '');

  if (!payload) {
    throw new Error('QR code image payload is empty');
  }

  if (!match && !/^[A-Za-z0-9+/=]+$/.test(payload)) {
    throw new Error('QR code image must be base64 data (with or without data URL prefix)');
  }

  return payload;
};

const decodeWithQrReader = (image) =>
  new Promise((resolve) => {
    const reader = new QrCode();
    reader.callback = (err, value) => {
      if (err || !value) return resolve(null);
      return resolve(value.result || null);
    };
    reader.decode(image.bitmap);
  });

const decodeFromImage = async (image) => {
  const { data, width, height } = image.bitmap;
  const clamped = Uint8ClampedArray.from(data);
  const primary = jsQR(clamped, width, height);
  if (primary && primary.data) return primary.data;
  return decodeWithQrReader(image);
};

const decodeQrImageDataUrl = async (dataUrl) => {
  const payload = extractBase64Payload(dataUrl);
  const buffer = Buffer.from(payload, 'base64');
  const image = await Jimp.read(buffer);
  let result = await decodeFromImage(image);
  if (result) return result;

  const variants = [
    image.clone().greyscale().contrast(0.5),
    image.clone().greyscale().contrast(0.8),
    image.clone().greyscale().contrast(0.5).resize(image.bitmap.width * 2, image.bitmap.height * 2),
    image.clone().greyscale().contrast(0.8).resize(image.bitmap.width * 2, image.bitmap.height * 2),
    image.clone().greyscale().contrast(0.5).resize(image.bitmap.width * 3, image.bitmap.height * 3),
  ];

  for (const variant of variants) {
    result = await decodeFromImage(variant);
    if (result) return result;
  }

  return null;
};

module.exports = {
  decodeQrImageDataUrl,
};
