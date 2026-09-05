import { Accordion, AccordionDetails, AccordionSummary, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

/**
 * PRD §128's "Why this?".
 *
 * COLLAPSED BY DEFAULT, and it shows `reasoning_summary` and nothing else. The
 * summary is a sentence the user may read; the model's working is never stored
 * and never shown (PRD §16, §88), so there is nothing else this could reveal.
 * The component is simply absent on a fallback reply, because a template has
 * no reasoning to explain.
 */
export default function WhyThisExpander({ summary }: { summary: string }) {
  return (
    <Accordion disableGutters elevation={0} sx={{ mt: 1, bgcolor: 'transparent' }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 36 }}>
        <Typography variant="body2" color="text.secondary">
          Why this?
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 0 }}>
        <Typography variant="body2" color="text.secondary">
          {summary}
        </Typography>
      </AccordionDetails>
    </Accordion>
  );
}
