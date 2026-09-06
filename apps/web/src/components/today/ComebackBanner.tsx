import { Alert, AlertTitle, Button, Stack } from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';
import { useNavigate } from 'react-router-dom';

import { COMEBACK_COPY } from '../../utils/comebackCopy';
import type { TodayComeback } from '../../types';

/**
 * "Welcome back. No catching up." (issue #119, epic E11).
 *
 * The first thing a returning user sees, and PRD §56's whole point is what it
 * does NOT contain: no count of what was missed, no red, no list. The banner
 * takes a state and a pointer, because that is all the API gives it — there is
 * no field here that could carry a backlog even by accident.
 */
interface Props {
  comeback: TodayComeback | null;
  onDismiss: () => void;
}

export default function ComebackBanner({ comeback, onDismiss }: Props) {
  const navigate = useNavigate();

  if (!comeback) return null;

  return (
    <Alert
      severity="info"
      icon={<ReplayIcon aria-hidden />}
      role="status"
      data-testid="comeback-banner"
      sx={{ mb: 2 }}
    >
      <AlertTitle>{COMEBACK_COPY.banner.title}</AlertTitle>
      {COMEBACK_COPY.banner.body}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.5 }}>
        <Button
          variant="contained"
          size="small"
          sx={{ minHeight: 44 }}
          onClick={() => navigate('/comeback')}
        >
          {COMEBACK_COPY.banner.restartLabel}
        </Button>
        <Button size="small" sx={{ minHeight: 44 }} onClick={onDismiss}>
          {COMEBACK_COPY.banner.dismissLabel}
        </Button>
      </Stack>
    </Alert>
  );
}
