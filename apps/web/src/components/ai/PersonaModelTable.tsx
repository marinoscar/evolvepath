/**
 * The persona × model matrix on `/admin/settings/ai`.
 *
 * Issue #27, epic #20. PRD §118 asks for model tiering — a small model for
 * extraction and notification rewrites, a strong reasoning model for planning
 * and weekly review — and this is the control that expresses it. The persona
 * list is the SERVER'S (`GET /api/ai-settings/personas`); this component never
 * declares one.
 *
 * -----------------------------------------------------------------------------
 * THE BREAKPOINT HERE IS NOT A SIXTH COUPLED GATE
 * -----------------------------------------------------------------------------
 *
 * `isCompactWindow` below switches ONE component between a table and a stack of
 * cards. It mounts no chrome, unmounts no navigation, and nothing outside this
 * file reads it. `docs/specs/settings-ui.md` §5 lists the five gates that ARE
 * coupled — the rail, the bottom bar, `<main>`'s padding, the hub and the
 * AppBar — and says in as many words that a component-local `down('sm')` for
 * layout inside a single page is allowed and is not one of them.
 *
 * A table is the right shape when there is room: five personas' models are
 * compared by scanning a column. Below `sm` a five-column table either scrolls
 * horizontally (so the comparison is impossible anyway) or crushes the labels,
 * and one card per persona keeps every control at a full-width tap target.
 *
 * -----------------------------------------------------------------------------
 * A STORED MODEL MISSING FROM THE CATALOG IS STILL OFFERED
 * -----------------------------------------------------------------------------
 *
 * If a persona is set to a model the current catalog does not list — the key
 * lost access to a tier, the provider retired a snapshot, the catalog fetch
 * failed and the list is empty — the value is still rendered as a selectable
 * option, marked "(not in catalog)". The alternative is a `Select` whose value
 * matches no option, which MUI renders as blank: the administrator would see
 * "Use default", believe that is what is configured, and silently overwrite a
 * deliberate choice on the next save.
 */

import {
  Box,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import type { AiModelInfo, AiPersona } from '../../types';

export interface PersonaModelTableProps {
  personas: AiPersona[];
  models: AiModelInfo[];
  personaModels: Partial<Record<string, string | null>>;
  defaultModel: string | null;
  disabled: boolean;
  onChange: (key: string, model: string | null) => void;
}

/**
 * `''` is the "Use default" option.
 *
 * MUI's `Select` needs a string, and `null` is not one. The mapping is confined
 * to the two helpers below so no call site has to remember which sentinel means
 * which — the `onChange` handler converts back before the value leaves.
 */
const USE_DEFAULT = '';

function selectValue(model: string | null | undefined): string {
  return model ?? USE_DEFAULT;
}

/** The catalog, plus the stored value when the catalog does not contain it. */
function optionsFor(models: AiModelInfo[], current: string | null | undefined): Array<{
  id: string;
  missing: boolean;
}> {
  const options = models.map((model) => ({ id: model.id, missing: false }));

  if (current && !models.some((model) => model.id === current)) {
    // Rendered FIRST so it is visible without scrolling a long catalog: it is
    // the value actually in force, and the one the administrator most needs to
    // notice is unusual.
    return [{ id: current, missing: true }, ...options];
  }

  return options;
}

export function PersonaModelTable({
  personas,
  models,
  personaModels,
  defaultModel,
  disabled,
  onChange,
}: PersonaModelTableProps) {
  const theme = useTheme();
  // See the header: a LOCAL layout choice, not one of the five coupled gates in
  // `docs/specs/settings-ui.md` §5.
  const isCompactWindow = useMediaQuery(theme.breakpoints.down('sm'));

  const defaultLabel = `Use default (${defaultModel ?? 'none'})`;

  /** The select, identical in both treatments so they cannot drift. */
  const renderSelect = (persona: AiPersona, labelId: string) => {
    const current = personaModels[persona.key] ?? null;

    return (
      <FormControl fullWidth size="small">
        {/* `shrink` is forced because the Select below sets `displayEmpty`: an
            un-shrunk label would sit on top of the rendered "Use default (…)"
            text. */}
        <InputLabel id={labelId} shrink>
          Model
        </InputLabel>
        <Select
          labelId={labelId}
          label="Model"
          // WITHOUT THIS, MUI RENDERS A BLANK BOX for the `''` value, so a
          // persona following the default looks unset — which is exactly the
          // confusion the "(not in catalog)" option below also exists to avoid.
          displayEmpty
          notched
          value={selectValue(current)}
          disabled={disabled}
          inputProps={{ 'aria-label': `Model for ${persona.label}` }}
          onChange={(event) => {
            const value = event.target.value as string;
            onChange(persona.key, value === USE_DEFAULT ? null : value);
          }}
        >
          <MenuItem value={USE_DEFAULT}>{defaultLabel}</MenuItem>
          {optionsFor(models, current).map((option) => (
            <MenuItem key={option.id} value={option.id}>
              {option.id}
              {option.missing ? ' (not in catalog)' : ''}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  };

  /** Tier and capability chips, shared by both treatments. */
  const renderChips = (persona: AiPersona) => (
    <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
      <Chip
        size="small"
        variant="outlined"
        label={persona.tier === 'reasoning' ? 'reasoning' : 'fast'}
      />
      {persona.capabilities.includes('vision') && (
        <Chip size="small" variant="outlined" color="info" label="vision" />
      )}
    </Stack>
  );

  if (personas.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No personas were returned by the server.
      </Typography>
    );
  }

  if (isCompactWindow) {
    return (
      <Stack spacing={2} data-testid="persona-model-cards">
        {personas.map((persona) => (
          <Card key={persona.key} variant="outlined">
            <CardContent>
              {/* `component="h4"` is explicit because MUI's `subtitle1`
                  renders an `<h6>`, which jumps four levels from the page's
                  `<h1>` and fails axe's heading-order rule. h4 is correct for
                  the one place this renders: under "Models by persona" (h3),
                  itself under "Models" (h2). If this component is ever mounted
                  somewhere shallower, that level becomes a prop. */}
              <Typography variant="subtitle1" component="h4" sx={{ fontWeight: 600 }}>
                {persona.label}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {persona.description}
              </Typography>
              {renderChips(persona)}
              <Box sx={{ mt: 2 }}>
                {renderSelect(persona, `persona-model-label-${persona.key}`)}
              </Box>
            </CardContent>
          </Card>
        ))}
      </Stack>
    );
  }

  return (
    <TableContainer data-testid="persona-model-table">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Persona</TableCell>
            <TableCell sx={{ width: { sm: 240, md: 300 } }}>Model</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {personas.map((persona) => (
            <TableRow key={persona.key}>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {persona.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {persona.description}
                </Typography>
                {renderChips(persona)}
              </TableCell>
              <TableCell>
                {renderSelect(persona, `persona-model-label-${persona.key}`)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
