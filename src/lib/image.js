// Client-side image validation + optimization before upload.

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_BYTES = 8 * 1024 * 1024 // must match storage bucket limits

export function validateImage(file) {
  if (!file) throw new Error('No image selected')
  if (!ALLOWED.includes(file.type)) throw new Error('Only JPG, PNG, WEBP or GIF images are allowed')
  if (file.size > MAX_BYTES) throw new Error('Image must be under 8MB')
  return true
}

// Downscales to maxDim and re-encodes. GIFs pass through untouched so animation survives.
export async function processImage(file, maxDim = 1280, quality = 0.82) {
  validateImage(file)
  if (file.type === 'image/gif') return file

  let img
  try {
    img = await createImageBitmap(file)
  } catch {
    img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Could not read that image'))
      i.src = URL.createObjectURL(file)
    })
  }

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  if (img.close) img.close()

  return await new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob || file),
      'image/webp',
      quality
    )
  })
}

export async function uploadImage(supabase, bucket, file, userId) {
  const blob = await processImage(file)
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/gif' ? 'gif' : blob.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    contentType: blob.type,
    cacheControl: '31536000',
  })
  if (error) throw error
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}
