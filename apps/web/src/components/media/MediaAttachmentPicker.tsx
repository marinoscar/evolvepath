import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';

import type {
  MediaAttachment,
  MediaPurpose,
  MediaTargetType,
} from '../../types';
import { getMediaPreviewUrl, getStorageQuota } from '../../services/api';
import { ACCEPT_ATTRIBUTE, humanBytes } from '../../lib/mediaLimits';
import { useMediaUpload, type UploadItem } from '../../hooks/useMediaUpload';

interface MediaAttachmentPickerProps {
  purpose: MediaPurpose;
  targetType?: MediaTargetType;
  targetId?: string;
  maxFiles?: number;
  onAttached: (attachments: MediaAttachment[]) => void;
  disabled?: boolean;
}

/**
 * Pick, capture, upload and follow media (issue #91, epic #67).
 *
 * PHONE-FIRST, and the difference is not cosmetic. Below `sm` the control is a
 * single button that opens the camera (`capture="environment"`); at `sm` and
 * above it is a drop zone. PRD §123 puts behaviour intervention "near the
 * moment of action", which for a form check means somebody standing at a squat
 * rack with one hand free.
 *
 * ⚠️ The `down('sm')` below is a LOCAL LAYOUT CHOICE and is **not** one of the
 * five coupled breakpoint gates listed in `common/Layout.tsx`. It mounts
 * neither navigation nor a shell; changing it changes this component and
 * nothing else. Same status as `SettingsHub`'s comment, opposite conclusion.
 */
export function MediaAttachmentPicker({
  purpose,
  targetType,
  targetId,
  maxFiles = 1,
  onAttached,
  disabled = false,
}: MediaAttachmentPickerProps) {
  const theme = useTheme();
  const isCompactWindow = useMediaQuery(theme.breakpoints.down('sm'));

  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);

  const [dragActive, setDragActive] = useState(false);
  const [remaining, setRemaining] = useState<string | null>(null);

  const { items, addFiles, remove, retry } = useMediaUpload({
    purpose,
    targetType,
    targetId,
    onAttached,
  });

  // The quota caption. Re-read whenever an item settles, because the number
  // the user is looking at is exactly the one their upload just changed.
  const settledCount = items.filter(
    (item) => item.phase === 'ready' || item.phase === 'failed',
  ).length;

  useEffect(() => {
    let cancelled = false;
    getStorageQuota()
      .then((quota) => {
        if (cancelled) return;
        // null means quotas are off — render nothing rather than a bar with no
        // ceiling.
        setRemaining(quota.remainingBytes);
      })
      .catch(() => {
        // A quota we cannot read is a caption we do not show. It is never a
        // reason to stop somebody uploading.
        if (!cancelled) setRemaining(null);
      });
    return () => {
      cancelled = true;
    };
  }, [settledCount]);

  const atCapacity = items.length >= maxFiles;
  const isDisabled = disabled || atCapacity;

  const accept = (files: FileList | null) => {
    if (!files || isDisabled) return;
    const room = Math.max(0, maxFiles - items.length);
    addFiles(Array.from(files).slice(0, room));
  };

  return (
    <Box>
      {isCompactWindow ? (
        <Stack spacing={1}>
          <Button
            fullWidth
            variant="contained"
            startIcon={<PhotoCameraIcon />}
            disabled={isDisabled}
            onClick={() => cameraInput.current?.click()}
            sx={{ minHeight: 48 }}
          >
            Take photo or video
          </Button>
          <Button
            fullWidth
            variant="text"
            size="small"
            disabled={isDisabled}
            onClick={() => libraryInput.current?.click()}
          >
            Choose from library
          </Button>
        </Stack>
      ) : (
        <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
          {/* The drop zone is itself the keyboard control. "Choose files" sits
              OUTSIDE it rather than inside: a focusable button nested in a
              `role="button"` is `nested-interactive`, a real axe violation
              rather than a lint nit — a screen reader announces one control
              and the user finds two. */}
          <Box
            role="button"
            tabIndex={isDisabled ? -1 : 0}
            aria-label="Add photos or videos"
            aria-disabled={isDisabled}
            onClick={() => !isDisabled && libraryInput.current?.click()}
            onKeyDown={(event) => {
              if (isDisabled) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                libraryInput.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (!isDisabled) setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              accept(event.dataTransfer.files);
            }}
            sx={{
              width: '100%',
              p: 3,
              borderRadius: 1,
              border: '2px dashed',
              borderColor: dragActive ? 'primary.main' : 'divider',
              bgcolor: dragActive ? 'action.hover' : 'transparent',
              textAlign: 'center',
              cursor: isDisabled ? 'not-allowed' : 'pointer',
              opacity: isDisabled ? 0.6 : 1,
            }}
          >
            <CloudUploadIcon color="action" />
            <Typography variant="body2" sx={{ mt: 1 }}>
              Drag a photo or video here
            </Typography>
          </Box>
          <Button
            variant="outlined"
            size="small"
            disabled={isDisabled}
            onClick={() => libraryInput.current?.click()}
          >
            Choose files
          </Button>
        </Stack>
      )}

      {/* Two inputs, not one with a toggled attribute: `capture` cannot be
          removed from a mounted input in every browser, and "open the camera"
          and "open the library" are two different things the user asked for. */}
      <input
        ref={cameraInput}
        data-testid="media-picker-input"
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        capture="environment"
        hidden
        onChange={(event) => {
          accept(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={libraryInput}
        data-testid="media-picker-library-input"
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple={maxFiles > 1}
        hidden
        onChange={(event) => {
          accept(event.target.files);
          event.target.value = '';
        }}
      />

      {remaining !== null && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 1 }}
        >
          {humanBytes(Number(remaining))} of storage left
        </Typography>
      )}

      {/* Phase changes are announced, because the interesting moment —
          "Processing…" becoming "Ready" — happens without a click. */}
      <Box aria-live="polite" sx={{ mt: 2 }}>
        <Stack spacing={1.5}>
          {items.map((item) => (
            <UploadRow
              key={item.localId}
              item={item}
              onRemove={() => remove(item.localId)}
              onRetry={() => retry(item.localId)}
            />
          ))}
        </Stack>
      </Box>
    </Box>
  );
}

const PHASE_LABEL: Record<UploadItem['phase'], string> = {
  validating: 'Checking…',
  uploading: 'Uploading',
  processing: 'Processing…',
  ready: 'Ready',
  failed: 'Failed',
};

/**
 * One file's row.
 *
 * Every phase carries an ICON AND TEXT. PRD §122: status must not be conveyed
 * by colour alone, and "the green one is fine" is not a thing a colour-blind
 * user or a screen reader can act on.
 */
function UploadRow({
  item,
  onRemove,
  onRetry,
}: {
  item: UploadItem;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const [frameUrl, setFrameUrl] = useState<string | null>(null);

  // Once a video is ready the local object URL shows a black poster; the
  // server's first sampled frame is the picture of what was filmed.
  useEffect(() => {
    if (item.phase !== 'ready' || !item.attachment) return;
    if (item.attachment.kind !== 'VIDEO') return;

    let cancelled = false;
    getMediaPreviewUrl(item.attachment.id, 'frame', 0)
      .then((preview) => {
        if (!cancelled) setFrameUrl(preview.url);
      })
      .catch(() => {
        // A missing thumbnail is not worth an error state; the local preview
        // stays.
      });
    return () => {
      cancelled = true;
    };
  }, [item.attachment, item.phase]);

  const isVideo = item.file.type.startsWith('video/');

  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{ alignItems: 'center' }}
      data-testid="media-item"
    >
      <Box
        sx={{
          width: 56,
          height: 56,
          borderRadius: 1,
          overflow: 'hidden',
          bgcolor: 'action.hover',
          flexShrink: 0,
        }}
      >
        {isVideo && !frameUrl ? (
          <video
            src={item.previewUrl}
            muted
            preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <img
            src={frameUrl ?? item.previewUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
      </Box>

      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap title={item.file.name}>
          {item.file.name}
        </Typography>

        <Chip
          size="small"
          data-testid="media-item-status"
          icon={phaseIcon(item.phase)}
          color={phaseColor(item.phase)}
          label={
            item.phase === 'uploading'
              ? `Uploading ${item.progress} %`
              : item.phase === 'failed' && item.error
                ? `Failed: ${item.error}`
                : PHASE_LABEL[item.phase]
          }
          sx={{ mt: 0.5, maxWidth: '100%' }}
        />

        {item.phase === 'uploading' && (
          <LinearProgress
            variant="determinate"
            value={item.progress}
            aria-label={`Uploading ${item.file.name}`}
            aria-valuenow={item.progress}
            sx={{ mt: 0.5 }}
          />
        )}
      </Box>

      {item.phase === 'failed' && (
        <IconButton
          size="small"
          aria-label={`Retry ${item.file.name}`}
          onClick={onRetry}
        >
          <RefreshIcon fontSize="small" />
        </IconButton>
      )}

      <IconButton
        size="small"
        aria-label={`Remove ${item.file.name}`}
        onClick={onRemove}
      >
        <DeleteOutlineIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

function phaseIcon(phase: UploadItem['phase']) {
  switch (phase) {
    case 'ready':
      return <CheckCircleIcon />;
    case 'failed':
      return <ErrorOutlineIcon />;
    case 'processing':
      return <HourglassEmptyIcon />;
    default:
      return <CloudUploadIcon />;
  }
}

function phaseColor(phase: UploadItem['phase']) {
  if (phase === 'ready') return 'success' as const;
  if (phase === 'failed') return 'error' as const;
  return 'default' as const;
}

/** Re-exported so a caller can render an upload error without importing MUI. */
export { Alert as MediaPickerAlert };
