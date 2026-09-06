import { useState, useRef } from 'react';
import { Button, Box, Typography, CircularProgress } from '@mui/material';
import { CloudUpload as UploadIcon } from '@mui/icons-material';

import {
  getStorageDownloadUrl,
  getStorageObjectDetail,
  uploadStorageObject,
} from '../../services/api';

interface ImageUploadProps {
  onUpload: (url: string) => void;
  disabled?: boolean;
}

/** Profile images are small; this is a friendlier limit than the server's. */
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** Poll for `ready`: normalization (#87) runs before a download URL is legal. */
const POLL_INTERVAL_MS = 1000;
const POLL_ATTEMPTS = 15;

/**
 * Upload a custom profile image (rewritten by issue #91, epic #67).
 *
 * It previously posted a raw `fetch` to `/api/users/profile-image` — an
 * endpoint that has never existed — bypassing `ApiService` and therefore token
 * refresh and the error envelope with it. Nothing here worked; it merely
 * failed quietly.
 *
 * NOTE ON WHAT `onUpload` RECEIVES: a **signed** download URL, with the
 * lifetime `SIGNED_URL_EXPIRY` gives it (an hour by default). Persisting the
 * storage object id and resolving it on read is the right model and is a
 * deliberate follow-up, outside this epic — the props are unchanged so
 * `ProfileSettings` is untouched either way.
 */
export function ImageUpload({ onUpload, disabled = false }: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Please select a valid image file (JPEG, PNG, GIF, or WebP)');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError('File size must be less than 5MB');
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      const object = await uploadStorageObject(file);
      const ready = await waitForReady(object.id, object.status);

      if (ready === 'failed') {
        throw new Error('That image could not be processed.');
      }

      const { url } = await getStorageDownloadUrl(object.id);
      onUpload(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload image');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <Box sx={{ mt: 1 }}>
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_TYPES.join(',')}
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        disabled={disabled || isUploading}
      />
      <Button
        variant="outlined"
        size="small"
        startIcon={isUploading ? <CircularProgress size={16} /> : <UploadIcon />}
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || isUploading}
      >
        {isUploading ? 'Uploading...' : 'Upload Custom Image'}
      </Button>
      {error && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}

/**
 * A simple upload lands as `processing`, and `GET :id/download` answers 400
 * until the pipeline finishes. Bounded, so a stuck object shows an error rather
 * than a spinner that never stops.
 */
async function waitForReady(
  objectId: string,
  initialStatus: string,
): Promise<string> {
  let status = initialStatus;

  for (let attempt = 0; attempt < POLL_ATTEMPTS && status === 'processing'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    status = (await getStorageObjectDetail(objectId)).status;
  }

  return status;
}
