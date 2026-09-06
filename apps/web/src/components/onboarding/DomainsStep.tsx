import { forwardRef } from 'react';
import {
  Card,
  CardActionArea,
  CardContent,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';

import type { Domain, DomainReflections } from '../../types';
import { DOMAINS_QUESTION, DOMAINS_TITLE, DOMAIN_LABELS, DOMAIN_PROMPTS } from './copy';
import { StepShell } from './StepShell';

const ALL_DOMAINS: Domain[] = ['WORK', 'FAMILY', 'HEALTH'];

/** The reflection key for a domain — the API's shape is lower-case. */
const REFLECTION_KEY: Record<Domain, keyof DomainReflections> = {
  WORK: 'work',
  FAMILY: 'family',
  HEALTH: 'health',
};

export interface DomainsStepProps {
  domains: Domain[];
  reflections: DomainReflections;
  onToggle: (domain: Domain) => void;
  onReflectionChange: (domain: Domain, value: string) => void;
}

/**
 * Step 3 (PRD §20).
 *
 * Selecting a card EXPANDS its reflection field rather than opening a second
 * screen: the prompt is what makes the answer worth writing, and a user who has
 * just chosen "Family" is the person most likely to answer "what would the
 * people close to you notice?".
 */
export const DomainsStep = forwardRef<HTMLHeadingElement, DomainsStepProps>(
  function DomainsStep({ domains, reflections, onToggle, onReflectionChange }, ref) {
    return (
      <StepShell ref={ref} title={DOMAINS_TITLE} question={DOMAINS_QUESTION}>
        <Stack spacing={1.5}>
          {ALL_DOMAINS.map((domain) => {
            const selected = domains.includes(domain);

            return (
              <Card key={domain} variant="outlined" sx={{ borderColor: selected ? 'primary.main' : undefined }}>
                <CardActionArea
                  onClick={() => onToggle(domain)}
                  role="checkbox"
                  aria-checked={selected}
                  aria-label={DOMAIN_LABELS[domain]}
                >
                  <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    {selected ? (
                      <CheckCircleIcon color="primary" />
                    ) : (
                      <RadioButtonUncheckedIcon color="disabled" />
                    )}
                    <div>
                      {/* `component="span"`: MUI maps `subtitle1` to `<h6>`, which would
                          put an h6 directly under the step's h1 and break heading order. */}
                      <Typography variant="subtitle1" component="span" sx={{ display: 'block' }}>
                        {DOMAIN_LABELS[domain]}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {DOMAIN_PROMPTS[domain]}
                      </Typography>
                    </div>
                  </CardContent>
                </CardActionArea>

                {selected && (
                  <CardContent sx={{ pt: 0 }}>
                    <TextField
                      label={DOMAIN_PROMPTS[domain]}
                      value={reflections[REFLECTION_KEY[domain]] ?? ''}
                      onChange={(event) => onReflectionChange(domain, event.target.value)}
                      multiline
                      minRows={2}
                      fullWidth
                      size="small"
                      slotProps={{ htmlInput: { maxLength: 1000 } }}
                    />
                  </CardContent>
                )}
              </Card>
            );
          })}
        </Stack>
      </StepShell>
    );
  },
);
