/**
 * How to get an OpenAI API key — the same six steps, in two places.
 *
 * Issue #28, epic #20. Rendered OPEN on the first-login setup page (#29),
 * where the user has never seen this before and cannot proceed without it, and
 * COLLAPSED on the settings page, where they are usually replacing a key they
 * already know how to make.
 *
 * ONE COMPONENT WITH A VARIANT, not two copies. The steps are the part most
 * likely to go stale — OpenAI renames "API keys" or moves the billing prompt —
 * and a second copy would be the one nobody remembers to update, on whichever
 * page they happen not to be looking at.
 */

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Link,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

export interface OpenAiKeyInstructionsProps {
  /** `setup` renders open and unwrapped; `settings` renders inside a collapsed accordion. */
  variant: 'setup' | 'settings';
}

const API_KEYS_URL = 'https://platform.openai.com/api-keys';

function Steps() {
  return (
    <Box>
      <Box component="ol" sx={{ pl: 3, m: 0, '& li': { mb: 1 } }}>
        <li>
          Sign in at{' '}
          {/* `rel="noopener noreferrer"`: `target="_blank"` otherwise hands the
              opened page a `window.opener` reference back into this origin. */}
          <Link href={API_KEYS_URL} target="_blank" rel="noopener noreferrer">
            platform.openai.com
          </Link>
          .
        </li>
        <li>
          Open <strong>API keys</strong>.
        </li>
        <li>
          Click <strong>Create new secret key</strong>.
        </li>
        <li>Name it “EvolvePath”, so you can recognise it later.</li>
        <li>Copy the key — OpenAI shows it once and never again.</li>
        <li>Paste it below.</li>
      </Box>

      {/* The single most common reason a correctly-copied key fails, and the
          one this app cannot detect for the user: the key is valid, the account
          simply has no balance. Said up front rather than left to be discovered
          through a 429 that reads like a rate limit. */}
      <Alert severity="info" sx={{ mt: 2 }}>
        Billing must be enabled on your OpenAI account, or requests will fail even with a
        valid key.
      </Alert>
    </Box>
  );
}

export function OpenAiKeyInstructions({ variant }: OpenAiKeyInstructionsProps) {
  if (variant === 'setup') {
    return (
      <Box sx={{ mt: 2 }}>
        <Typography variant="subtitle1" component="h2" gutterBottom>
          How to get a key
        </Typography>
        <Steps />
      </Box>
    );
  }

  return (
    <Accordion
      elevation={0}
      disableGutters
      // MUI wraps an Accordion's summary in an `<h3>` by default, which jumps
      // two levels from a page's `<h1>` and fails axe's heading-order rule.
      slotProps={{ heading: { component: 'h2' } }}
      sx={{ border: 1, borderColor: 'divider', mb: 3 }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="body2">How do I get a key?</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Steps />
      </AccordionDetails>
    </Accordion>
  );
}
