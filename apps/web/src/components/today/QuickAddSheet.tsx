import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  SwipeableDrawer,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import WorkOutlineIcon from '@mui/icons-material/WorkOutlined';
import FamilyRestroomIcon from '@mui/icons-material/FamilyRestroom';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';

import type { CommitmentCard, Domain, Outcome } from '../../types';
import type { CommitmentFormValues } from '../../utils/commitmentForm.schema';
import { CommitmentEditorForm } from './CommitmentEditorForm';
import { NutritionBehaviourList } from '../health/NutritionBehaviourList';
import { useNutritionBehaviours } from '../../hooks/useNutritionBehaviours';
import { MealCheckPanel } from './MealCheckPanel';
import { WorkoutPickerPanel } from './WorkoutPickerPanel';

interface QuickAddSheetProps {
  open: boolean;
  /** Present for edit; absent for quick add. */
  editing?: CommitmentCard | null;
  outcomes: Outcome[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: CommitmentFormValues) => Promise<void>;
}

interface KindOption {
  key: string;
  label: string;
  helper: string;
  domain: Domain | null;
  Icon: typeof WorkOutlineIcon;
  disabled?: boolean;
}

/**
 * The things PRD §12.1 lists, plus E09's health entries.
 *
 * "Nutrition behaviour" is the one kind that does not open the commitment form.
 * PRD §46's whole point is that the user picks a behaviour rather than writing
 * one, so the sheet shows the registry instead — and the commitment it produces
 * is an ordinary one, created by the same service.
 */
const KINDS: KindOption[] = [
  {
    key: 'commitment',
    label: 'Commitment',
    helper: 'Anything you intend to do today',
    domain: null,
    Icon: PlaylistAddIcon,
  },
  {
    key: 'work',
    label: 'Work action',
    helper: 'One concrete step on something at work',
    domain: 'WORK',
    Icon: WorkOutlineIcon,
  },
  {
    key: 'family',
    label: 'Family intention',
    helper: 'Time with the people you care about',
    domain: 'FAMILY',
    Icon: FamilyRestroomIcon,
  },
  {
    key: 'nutrition',
    label: 'Eating habit',
    helper: 'Pick a behaviour, not a number',
    domain: 'HEALTH',
    Icon: RestaurantIcon,
  },
  {
    key: 'workout',
    label: 'Workout',
    helper: 'Start a session from your program',
    domain: 'HEALTH',
    Icon: FitnessCenterIcon,
  },
  {
    key: 'meal_check',
    label: 'Meal check',
    helper: 'Habits, not calories',
    domain: 'HEALTH',
    Icon: PhotoCameraIcon,
  },
];

/**
 * Quick add, and the editor behind it (epic E05, issue #52).
 *
 * A bottom sheet on a phone and a centred dialog above it. That `down('sm')` is
 * a LOCAL PRESENTATION CHOICE — it decides which container this one component
 * renders in — and deliberately NOT a sixth entry in the shell's five coupled
 * gates, which decide which navigation is mounted. Nothing in `Layout`,
 * `BottomNav`, `AppBar` or `SettingsHub` is touched by it.
 *
 * The kind chooser exists because "add a commitment" is a colder question than
 * "add a family intention", and picking a kind is one tap that pre-answers the
 * domain. It is skipped entirely in edit mode — the domain is already decided,
 * and the API refuses to change it.
 */
/**
 * The registry, fetched only once the user has asked for it.
 *
 * Inside the sheet rather than in `TodayPage`: the list is worth one request on
 * the tap that needs it, and hoisting it would put a request for eleven static
 * rows on every Today load.
 */
function NutritionBehaviourPicker({ onDone }: { onDone: () => void }) {
  const { behaviours, isLoading, error, commit } = useNutritionBehaviours();

  if (isLoading) return <Typography variant="body2">Loading…</Typography>;
  if (error) return <Typography variant="body2">{error}</Typography>;

  return (
    <NutritionBehaviourList
      behaviours={behaviours}
      onCommit={async (key, repeatDays) => {
        await commit(key, repeatDays);
        onDone();
      }}
    />
  );
}

export function QuickAddSheet({
  open,
  editing,
  outcomes,
  submitting,
  onClose,
  onSubmit,
}: QuickAddSheetProps) {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
  const [kind, setKind] = useState<KindOption | null>(null);

  // A reopened sheet starts at the chooser: the previous answer belonged to the
  // thing the user already added.
  useEffect(() => {
    if (!open) setKind(null);
  }, [open]);

  const isEdit = Boolean(editing);
  const title = isEdit ? 'Edit commitment' : (kind?.label ?? 'Add to today');

  const body =
    !isEdit && kind?.key === 'nutrition' ? (
      <NutritionBehaviourPicker onDone={onClose} />
    ) : !isEdit && kind?.key === 'workout' ? (
      <WorkoutPickerPanel onDone={onClose} />
    ) : !isEdit && kind?.key === 'meal_check' ? (
      <MealCheckPanel onDone={onClose} />
    ) : isEdit || kind ? (
      <CommitmentEditorForm
        mode={isEdit ? 'edit' : 'create'}
        initial={editing ?? undefined}
        initialDomain={kind?.domain ?? undefined}
        outcomes={outcomes}
        submitting={submitting}
        onSubmit={onSubmit}
        onCancel={onClose}
      />
    ) : (
      <Stack spacing={1.5} data-testid="quick-add-kinds">
        {KINDS.map((option) => (
          <Button
            key={option.key}
            variant="outlined"
            disabled={option.disabled}
            onClick={() => setKind(option)}
            data-testid={`quickadd-${option.key.replace(/_/g, '-')}`}
            startIcon={<option.Icon />}
            sx={{ justifyContent: 'flex-start', textAlign: 'left', p: 2, minHeight: 64 }}
          >
            <Box>
              <Typography component="span" sx={{ display: 'block', fontWeight: 500 }}>
                {option.label}
              </Typography>
              <Typography component="span" variant="caption" color="text.secondary">
                {option.helper}
              </Typography>
            </Box>
          </Button>
        ))}
      </Stack>
    );

  if (isPhone) {
    return (
      <SwipeableDrawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        onOpen={() => undefined}
        disableSwipeToOpen
        data-testid="quick-add-drawer"
        slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16 } } }}
      >
        <Box sx={{ p: 2, pb: 4 }} role="dialog" aria-labelledby="quick-add-title">
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" component="h2" id="quick-add-title" sx={{ flexGrow: 1 }}>
              {title}
            </Typography>
            <IconButton aria-label="Close" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Box>
          {body}
        </Box>
      </SwipeableDrawer>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="quick-add-title"
      data-testid="quick-add-dialog"
    >
      <DialogTitle id="quick-add-title">{title}</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>{body}</Box>
      </DialogContent>
    </Dialog>
  );
}
