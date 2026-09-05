import { useRef, useState } from 'react';
import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';

import { uploadMedia } from '../../../services/api';

interface MediaCaptureProps {
  /** What the button says, e.g. "Record a video of your set". */
  label: string;
  accept: string;
  /** `environment` opens the rear camera on a phone instead of the file picker. */
  capture?: 'environment' | 'user';
  disabled?: boolean;
  onUploaded: (storageObjectId: string) => void;
}

/**
 * Pick or capture one file, and hand back the object id (issue #111, epic E09).
 *
 * `capture="environment"` is the whole point on a phone: PRD §123 is
 * mobile-first, and a form check that opens a file browser instead of the
 * camera is a feature nobody uses in a gym. On a desktop the attribute is
 * ignored and the same input is a file picker, so there is one code path
 * rather than a width gate.
 *
 * DELIBERATELY MINIMAL, and a temporary home. E03 (epic #67) owns
 * `MediaAttachmentPicker` with its purposes, targets and processing states;
 * this uploads one file through the existing storage endpoint so E09's three
 * coaching flows have an entry point today. When the picker lands, these three
 * call sites swap component and keep their logic.
 */
export function MediaCapture({
  label,
  accept,
  capture,
  disabled = false,
  onUploaded,
}: MediaCaptureProps) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const object = await uploadMedia(file);
      onUploaded(object.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That upload did not work.');
    } finally {
      setUploading(false);
      // So picking the same file twice still fires a change event.
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Button
          variant="outlined"
          startIcon={<PhotoCameraIcon />}
          disabled={disabled || uploading}
          onClick={() => input.current?.click()}
          sx={{ minHeight: 44 }}
        >
          {label}
        </Button>
        <input
          ref={input}
          type="file"
          accept={accept}
          capture={capture}
          hidden
          aria-label={label}
          onChange={(event) => void handleChange(event)}
        />
      </Stack>

      {uploading ? (
        <Box sx={{ mt: 2 }} role="status">
          <Typography variant="body2" color="text.secondary">
            Uploading…
          </Typography>
          <LinearProgress sx={{ mt: 1 }} />
        </Box>
      ) : null}

      {error ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      ) : null}
    </Box>
  );
}
