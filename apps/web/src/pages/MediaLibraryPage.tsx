import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Fab,
  Grid,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

import type { MediaAttachment, MediaPurpose } from '../types';
import {
  deleteMediaAttachment,
  getMediaPreviewUrl,
  listMediaAttachments,
} from '../services/api';
import { AskAboutMediaDialog } from '../components/media/AskAboutMediaDialog';
import { MediaAdviceCard } from '../components/media/MediaAdviceCard';
import { useIsMounted } from '../hooks/useIsMounted';

const PURPOSE_LABEL: Record<MediaPurpose, string> = {
  WORKOUT_FORM: 'Workout form',
  EQUIPMENT: 'Equipment',
  MEAL: 'Meal',
  GENERAL: 'Something else',
};

/**
 * `/media` — everything the user has handed the coach (issue #96, epic #67).
 *
 * It exists so the generic flow is REACHABLE before E06 and E09 wire the same
 * dialog into their own screens. It is also the place a user goes when they
 * closed the dialog while an answer was still coming: the advice lands on the
 * attachment either way, and this is where they find it.
 *
 * ⚠️ The `down('sm')` is a page-local layout choice (cards versus a grid) and
 * is **not** one of the five coupled breakpoint gates.
 */
export default function MediaLibraryPage() {
  const theme = useTheme();
  const isCompactWindow = useMediaQuery(theme.breakpoints.down('sm'));
  const isMounted = useIsMounted();

  const [items, setItems] = useState<MediaAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [asking, setAsking] = useState<MediaAttachment | undefined>();
  const [confirming, setConfirming] = useState<MediaAttachment | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listMediaAttachments({ pageSize: 50 });
      if (isMounted()) setItems(result.items);
    } catch (err) {
      if (isMounted()) {
        setError(err instanceof Error ? err.message : 'Could not load media');
        setItems([]);
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openAsk = (attachment?: MediaAttachment) => {
    setAsking(attachment);
    setAskOpen(true);
  };

  const confirmDelete = async () => {
    if (!confirming) return;
    const id = confirming.id;
    setConfirming(null);
    await deleteMediaAttachment(id);
    // Refetch rather than splicing: the API decides the ordering, and
    // reproducing it here would be a second, wrong implementation of it.
    await refresh();
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h5" component="h1" gutterBottom>
        Media
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {isLoading ? (
        <CircularProgress aria-label="Loading media" />
      ) : items.length === 0 ? (
        <Stack spacing={2} sx={{ alignItems: 'flex-start', mt: 2 }}>
          <Typography color="text.secondary">No media yet</Typography>
          <Button variant="contained" onClick={() => openAsk()}>
            Add media
          </Button>
        </Stack>
      ) : isCompactWindow ? (
        <Stack spacing={2}>
          {items.map((item) => (
            <MediaCard
              key={item.id}
              attachment={item}
              expanded={expanded === item.id}
              onToggleAdvice={() =>
                setExpanded(expanded === item.id ? null : item.id)
              }
              onAsk={() => openAsk(item)}
              onDelete={() => setConfirming(item)}
            />
          ))}
        </Stack>
      ) : (
        <Grid container spacing={2}>
          {items.map((item) => (
            <Grid key={item.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <MediaCard
                attachment={item}
                expanded={expanded === item.id}
                onToggleAdvice={() =>
                  setExpanded(expanded === item.id ? null : item.id)
                }
                onAsk={() => openAsk(item)}
                onDelete={() => setConfirming(item)}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {isCompactWindow && items.length > 0 && (
        <Fab
          color="primary"
          aria-label="Add media"
          onClick={() => openAsk()}
          sx={{ position: 'fixed', bottom: 80, right: 16 }}
        >
          <AddIcon />
        </Fab>
      )}

      {!isCompactWindow && items.length > 0 && (
        <Button variant="outlined" sx={{ mt: 2 }} onClick={() => openAsk()}>
          Add media
        </Button>
      )}

      <AskAboutMediaDialog
        open={askOpen}
        attachment={asking}
        onClose={() => {
          setAskOpen(false);
          void refresh();
        }}
        onAsked={() => void refresh()}
      />

      <Dialog open={confirming !== null} onClose={() => setConfirming(null)}>
        <DialogTitle>Delete this media?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The file and anything the coach said about it are removed. This
            cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)}>Cancel</Button>
          <Button color="error" onClick={() => void confirmDelete()}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function MediaCard({
  attachment,
  expanded,
  onToggleAdvice,
  onAsk,
  onDelete,
}: {
  attachment: MediaAttachment;
  expanded: boolean;
  onToggleAdvice: () => void;
  onAsk: () => void;
  onDelete: () => void;
}) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  useEffect(() => {
    if (attachment.processingStatus !== 'ready') return;

    let cancelled = false;
    // A video's first sampled frame; a photo's normalized variant. `ai` falls
    // back to the original server-side, so this is one call either way.
    getMediaPreviewUrl(
      attachment.id,
      attachment.kind === 'VIDEO' ? 'frame' : 'ai',
      0,
    )
      .then((preview) => {
        if (!cancelled) setThumbnail(preview.url);
      })
      .catch(() => {
        // A missing thumbnail is not worth an error state.
      });

    return () => {
      cancelled = true;
    };
  }, [attachment.id, attachment.kind, attachment.processingStatus]);

  return (
    <Card data-testid="media-card">
      {thumbnail && (
        <Box
          component="img"
          src={thumbnail}
          alt=""
          sx={{ width: '100%', height: 160, objectFit: 'cover' }}
        />
      )}
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Chip size="small" label={PURPOSE_LABEL[attachment.purpose]} />
          <Chip
            size="small"
            label={
              attachment.processingStatus === 'ready'
                ? 'Ready'
                : attachment.processingStatus === 'failed'
                  ? 'Failed'
                  : 'Processing…'
            }
            color={
              attachment.processingStatus === 'ready'
                ? 'success'
                : attachment.processingStatus === 'failed'
                  ? 'error'
                  : 'default'
            }
          />
        </Stack>

        {attachment.aiSummary && (
          <>
            <Button size="small" sx={{ mt: 1 }} onClick={onToggleAdvice}>
              {expanded ? 'Hide the coach’s notes' : 'The coach’s notes'}
            </Button>
            <Collapse in={expanded} unmountOnExit>
              <Box sx={{ mt: 1 }}>
                <MediaAdviceCard
                  advice={attachment.aiSummary}
                  kind={attachment.kind}
                  askedAt={attachment.aiSummary.askedAt}
                />
              </Box>
            </Collapse>
          </>
        )}
      </CardContent>

      <CardActions>
        <Button
          size="small"
          disabled={attachment.processingStatus !== 'ready'}
          onClick={onAsk}
        >
          Ask the coach
        </Button>
        <Button size="small" color="error" onClick={onDelete}>
          Delete
        </Button>
      </CardActions>
    </Card>
  );
}
