// Cloudflare R2 upload service for backend (Node.js)
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'linkng-storage';
const PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL || `https://${BUCKET_NAME}.${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;

/**
 * Upload buffer to Cloudflare R2
 * @param {Buffer|ArrayBuffer} buffer - Video/image buffer
 * @param {string} key - R2 object key (path)
 * @param {string} contentType - MIME type (e.g., 'video/mp4')
 * @returns {Promise<{url: string, key: string, bucket: string}>}
 */
async function uploadBufferToR2(buffer, key, contentType) {
  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('Cloudflare R2 credentials not configured. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID');
  }

  // Normalize key (remove leading slash, ensure proper path)
  const normalizedKey = key.replace(/^\//, '').replace(/\/+/g, '/');
  const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${BUCKET_NAME}/objects/${normalizedKey}`;

  console.log(`📤 [R2 Upload] Uploading to: ${normalizedKey}`);
  console.log(`   Size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Content-Type: ${contentType}`);

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': contentType,
    },
    body: buffer,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ [R2 Upload] Upload failed:`, {
      status: response.status,
      statusText: response.statusText,
      errorText,
      url: uploadUrl
    });
    throw new Error(`R2 upload failed: ${response.status} ${errorText}`);
  }

  // Construct public URL
  const normalizedPublicUrl = PUBLIC_URL.replace(/\/$/, '');
  const publicUrl = `${normalizedPublicUrl}/${normalizedKey}`;

  console.log(`✅ [R2 Upload] Upload successful: ${publicUrl}`);

  return {
    url: publicUrl,
    key: normalizedKey,
    bucket: BUCKET_NAME
  };
}

/**
 * Check if object exists in R2 (by checking public URL)
 * @param {string} key - R2 object key
 * @returns {Promise<string|null>} - Public URL if exists, null otherwise
 */
async function checkR2ObjectExists(key) {
  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
    return null;
  }

  const normalizedPublicUrl = PUBLIC_URL.replace(/\/$/, '');
  const normalizedKey = key.replace(/^\//, '').replace(/\/+/g, '/');
  const publicUrl = `${normalizedPublicUrl}/${normalizedKey}`;

  try {
    const res = await fetch(publicUrl, { method: 'HEAD' });
    if (res.ok) {
      return publicUrl;
    }
  } catch (e) {
    // Object doesn't exist or not accessible
  }
  return null;
}

module.exports = {
  uploadBufferToR2,
  checkR2ObjectExists
};


