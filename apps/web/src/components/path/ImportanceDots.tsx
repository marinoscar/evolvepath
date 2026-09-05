import { Box } from '@mui/material';

interface ImportanceDotsProps {
  value: number;
  max?: number;
  label?: string;
}

/**
 * Importance as filled dots, with a text alternative.
 *
 * PRD §122: colour is never the only carrier of meaning. Five dots of which
 * four are filled is a SHAPE difference as well as a colour one, and the
 * `aria-label` says the number outright — so the value survives a screen
 * reader, a monochrome display and colour-blindness alike.
 */
export function ImportanceDots({ value, max = 5, label = 'Importance' }: ImportanceDotsProps) {
  return (
    <Box
      role="img"
      aria-label={`${label} ${value} of ${max}`}
      sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'center' }}
    >
      {Array.from({ length: max }, (_, index) => (
        <Box
          key={index}
          aria-hidden
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: index < value ? 'primary.main' : 'action.disabledBackground',
            // A border on the empty dots so they remain visible against a
            // background that happens to match `action.disabledBackground`.
            border: index < value ? 'none' : '1px solid',
            borderColor: 'divider',
          }}
        />
      ))}
    </Box>
  );
}

export default ImportanceDots;
