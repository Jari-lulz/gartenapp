// Verkleinert Handyfotos, damit sie schnell übertragen werden und wenig Speicher brauchen.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Foto konnte nicht geladen werden.')); };
    img.src = url;
  });
}

function toDataUrl(img, max, quality) {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function prepareImage(file, { max = 1280, quality = 0.82 } = {}) {
  const img = await loadImage(file);
  return {
    photo: toDataUrl(img, max, quality),
    thumb: toDataUrl(img, 360, 0.7),
  };
}
