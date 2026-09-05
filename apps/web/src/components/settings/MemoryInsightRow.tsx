import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  ListItem,
  Menu,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';

import type { MemoryInsight } from '../../types';

// =============================================================================
// One thing the coach remembers (issue #90, epic E06)
// =============================================================================
//
// CONFIDENCE IS SHOWN AS WORDS, NEVER AS A NUMBER. "0.72" invites the reader to
// treat a heuristic as a measurement and to argue with the second decimal
// place; "likely" says the only thing the number actually supports. VISION §12's
// objection to scores applies here as much as it does to the family summary.
//
// The switch's accessible name INCLUDES THE STATEMENT. A screen-reader user
// moving through eight rows of "Use for coaching" toggles has no way to tell
// which sentence each one governs.
// =============================================================================

/** The three words confidence is ever rendered as. */
export function confidenceWord(confidence: number): string {
  if (confidence >= 0.7) return 'likely';
  if (confidence >= 0.4) return 'possible';
  return 'tentative';
}

export interface MemoryInsightRowProps {
  insight: MemoryInsight;
  onConfirm: (id: string) => void;
  onEdit: (id: string, statement: string) => void;
  onSetDoNotUse: (id: string, doNotUse: boolean) => void;
  onForget: (id: string) => void;
}

export default function MemoryInsightRow({
  insight,
  onConfirm,
  onEdit,
  onSetDoNotUse,
  onForget,
}: MemoryInsightRowProps) {
  const theme = useTheme();
  // Page-local layout switch, like `CoachPage`'s — not one of the five coupled
  // breakpoint gates.
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(insight.statement);
  const [confirming, setConfirming] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);

  const closeMenu = () => setMenuAnchor(null);

  const actions = (
    <>
      {!insight.userConfirmed && (
        <Button size="small" onClick={() => onConfirm(insight.id)}>
          Confirm
        </Button>
      )}
      <Button size="small" onClick={() => setEditing(true)}>
        Edit
      </Button>
      <Button size="small" color="error" onClick={() => setConfirming(true)}>
        Forget
      </Button>
    </>
  );

  return (
    <ListItem
      divider
      sx={{ display: 'block', py: 2 }}
      data-testid={`memory-insight-${insight.id}`}
    >
      {editing ? (
        <Stack spacing={1}>
          <TextField
            fullWidth
            multiline
            size="small"
            label="Statement"
            value={draft}
            slotProps={{ htmlInput: { maxLength: 280 } }}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="contained"
              disabled={draft.trim().length === 0}
              onClick={() => {
                setEditing(false);
                onEdit(insight.id, draft.trim());
              }}
            >
              Save
            </Button>
            <Button
              size="small"
              onClick={() => {
                setDraft(insight.statement);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Stack
          direction={narrow ? 'column' : 'row'}
          spacing={1}
          sx={{ alignItems: narrow ? 'stretch' : 'flex-start' }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body1">{insight.statement}</Typography>

            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: 'wrap', mt: 1 }}
            >
              <Chip
                size="small"
                label={insight.userConfirmed ? 'Confirmed' : 'Unconfirmed'}
                color={insight.userConfirmed ? 'success' : 'default'}
                variant={insight.userConfirmed ? 'filled' : 'outlined'}
              />
              {insight.doNotUse && (
                <Chip size="small" label="Not used for coaching" variant="outlined" />
              )}
              <Chip
                size="small"
                variant="outlined"
                label={
                  insight.source === 'AI' ? 'Suggested by the coach' : 'Added by you'
                }
              />
              <Chip
                size="small"
                variant="outlined"
                label={confidenceWord(insight.confidence)}
              />
              {insight.evidenceCount > 0 && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`Based on ${insight.evidenceCount} observations`}
                />
              )}
              {insight.expiresAt && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`Expires ${new Date(insight.expiresAt).toLocaleDateString()}`}
                />
              )}
            </Stack>

            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', mt: 1 }}
            >
              <Switch
                size="small"
                checked={!insight.doNotUse}
                // The statement is in the name: eight identical "Use for
                // coaching" toggles are unusable without it.
                slotProps={{
                  input: { 'aria-label': `Use "${insight.statement}" for coaching` },
                }}
                onChange={(event) =>
                  onSetDoNotUse(insight.id, !event.target.checked)
                }
              />
              <Typography variant="body2" color="text.secondary">
                {insight.doNotUse ? "Don't use for coaching" : 'Use for coaching'}
              </Typography>
            </Stack>
          </Box>

          {narrow ? (
            <>
              <IconButton
                aria-label="More actions"
                sx={{ alignSelf: 'flex-end' }}
                onClick={(event) => setMenuAnchor(event.currentTarget)}
              >
                <MoreVertIcon />
              </IconButton>
              <Menu
                anchorEl={menuAnchor}
                open={menuAnchor !== null}
                onClose={closeMenu}
              >
                {!insight.userConfirmed && (
                  <MenuItem
                    onClick={() => {
                      closeMenu();
                      onConfirm(insight.id);
                    }}
                  >
                    Confirm
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    closeMenu();
                    setEditing(true);
                  }}
                >
                  Edit
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    closeMenu();
                    setConfirming(true);
                  }}
                >
                  Forget
                </MenuItem>
              </Menu>
            </>
          ) : (
            <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
              {actions}
            </Stack>
          )}
        </Stack>
      )}

      <Dialog open={confirming} onClose={() => setConfirming(false)}>
        <DialogTitle>Forget this insight?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {/* PRD §85 Forget is a hard delete on the server. Saying so is the
                difference between an informed choice and a surprise. */}
            This can&apos;t be undone. The coach keeps no copy.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => {
              setConfirming(false);
              onForget(insight.id);
            }}
          >
            Forget
          </Button>
        </DialogActions>
      </Dialog>
    </ListItem>
  );
}
