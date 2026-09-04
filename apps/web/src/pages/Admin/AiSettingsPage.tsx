/**
 * Admin → Settings → AI (`/admin/settings/ai`).
 *
 * Issue #27, epic #20. A registry card, a route gated on the same permission
 * string, and no tab anywhere — the hub, the Console rail and the compact
 * AppBar title all pick it up from that single declaration. See
 * `docs/specs/settings-ui.md`.
 *
 * DELIBERATELY SHAPED AFTER `EmailSettingsPage`. Same chrome, same form-state
 * discipline, same `testBlockedReason` prose, same 409 handling, same
 * persistent-dismissible-alert treatment for the diagnostic. The two pages
 * solve the same problem — "configure an external service and prove it works"
 * — and a second, differently-shaped answer to it would be two patterns for
 * this codebase to demonstrate rather than one.
 *
 * THE TEST BUTTON IS THE POINT OF THE PAGE, exactly as it is for email. A wrong
 * key, a model the account has not been granted, and a firewalled egress all
 * fail, and they fail differently; the provider's own error text is the only
 * thing that tells them apart. So the failure surface is a persistent,
 * dismissible alert with room for a multi-line provider message — never a
 * snackbar that slides away in five seconds carrying the one string the
 * administrator needed to read twice.
 *
 * WHAT IS NOT ON THIS PAGE: any user's key. Every user brings their own
 * (`/settings/ai-key`, #28); the platform key here serves only the model
 * catalog and this page's own test.
 */

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AlertTitle,
  Box,
  Button,
  Container,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Select,
  Snackbar,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import BoltIcon from '@mui/icons-material/Bolt';
import { Navigate } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { useAiSettings } from '../../hooks/useAiSettings';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { PersonaModelTable } from '../../components/ai/PersonaModelTable';
import { formatRelativeTime } from '../../utils/relativeTime';
import type {
  AiPlatformKeyStatus,
  AiProviderKind,
  AiSettings,
  AiSettingsInput,
} from '../../types';

/**
 * The form's own state, flat and all-strings-where-typed.
 *
 * `personaModels` is the one structured member, because it is genuinely a map
 * and flattening it would mean a key per persona in a type that must not need
 * editing when a persona is added.
 */
interface AiFormState {
  /** `null` is "no provider chosen", exactly as on the wire. */
  provider: AiProviderKind | null;
  enabled: boolean;
  baseUrl: string;
  defaultModel: string | null;
  personaModels: Partial<Record<string, string | null>>;
}

/** `''` is "no default chosen" in the Select, mirroring `PersonaModelTable`. */
const NO_DEFAULT = '';

function toFormState(settings: AiSettings): AiFormState {
  return {
    provider: settings.provider,
    enabled: settings.enabled,
    baseUrl: settings.baseUrl ?? '',
    defaultModel: settings.defaultModel,
    // Copied, not referenced: the form mutates it and the settings object is
    // also the dirty-check baseline.
    personaModels: { ...settings.personaModels },
  };
}

/**
 * The provider radio group's value.
 *
 * `''` — no radio selected — is `provider: null`, a fresh install where nothing
 * has been chosen. That is the honest rendering of a nullable field.
 *
 * THERE IS NO RADIO FOR "OFF", for the same reason there is none on the email
 * page: turning AI off is the `enabled` switch, a separate control for a
 * separate field. Folding them would make "off, OpenAI retained" and "never
 * configured" the same choice, and switching AI off during an incident would
 * cost the administrator their whole model configuration.
 */
function providerChoice(provider: AiProviderKind | null): string {
  return provider ?? '';
}

/** Helper text under the platform key field. Never the key, only its mask. */
function describeKeyStatus(status: AiPlatformKeyStatus): string {
  if (!status.configured) {
    return 'No platform key is stored. It is used for the model catalog and for the test below.';
  }

  const which = status.hint ? ` · ${status.hint}` : '';
  const when = status.updatedAt
    ? ` · updated ${formatRelativeTime(status.updatedAt)}`
    : '';

  return `Configured${which}${when}. Leave blank to keep it, or type a new one to replace it.`;
}

export default function AiSettingsPage() {
  const { hasPermission } = usePermissions();
  const {
    settings,
    personas,
    models,
    isLoading,
    loadError,
    isSaving,
    saveError,
    isTesting,
    testResult,
    isRefreshingModels,
    save,
    test,
    refreshModels,
    clearTestResult,
    clearSaveError,
  } = useAiSettings();

  const [form, setForm] = useState<AiFormState | null>(null);
  /**
   * Held OUTSIDE `form` because it is not a value the page ever read — it is a
   * write-only instruction. Keeping it in the form object would put it in the
   * dirty comparison's baseline, where an empty string would have to mean both
   * "unchanged" and "erase" — the exact ambiguity blank-preserves removes.
   */
  const [platformApiKey, setPlatformApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // The server's response is the new baseline after every load AND every save,
  // so this also clears the key box once a save has consumed it. Leaving a
  // typed key on screen after a successful save would imply it is still
  // pending, and the next save would send it again.
  useEffect(() => {
    if (settings) {
      setForm(toFormState(settings));
      setPlatformApiKey('');
      setShowKey(false);
    }
  }, [settings]);

  // Defence, not the gate — `App.tsx` wraps the route in `RequirePermission`
  // with this same string. This catches the page mounted from anywhere else. It
  // sits after every hook so the hook order never changes.
  if (!hasPermission('system_settings:read')) {
    return <Navigate to="/" replace />;
  }

  const canWrite = hasPermission('system_settings:write');

  if (isLoading || (!form && !loadError)) {
    return <LoadingSpinner />;
  }

  // A typed key counts as a change even when every other field matches: it is
  // the one edit that leaves no visible trace in the form baseline.
  const isDirty =
    !!form &&
    !!settings &&
    (JSON.stringify(form) !== JSON.stringify(toFormState(settings)) ||
      platformApiKey !== '');

  const update = <K extends keyof AiFormState>(key: K, value: AiFormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const setPersonaModel = (persona: string, model: string | null) => {
    setForm((prev) =>
      prev
        ? { ...prev, personaModels: { ...prev.personaModels, [persona]: model } }
        : prev,
    );
  };

  const toInput = (state: AiFormState): AiSettingsInput => ({
    // Required and not blankable: `null` is a real persisted value for
    // `provider`, and `enabled` is a boolean the API always expects.
    provider: state.provider,
    enabled: state.enabled,

    // An emptied box goes as `''`, not as an omitted key. The API's
    // `blankable` union exists to accept exactly what a cleared control
    // produces and convert it to "absent" once, server-side — sending `''` says
    // what the administrator did rather than reimplementing that conversion.
    baseUrl: state.baseUrl.trim(),

    defaultModel: state.defaultModel,
    personaModels: state.personaModels,

    // THE ONE EXCEPTION, AND THE OPPOSITE MEANING. For `baseUrl`, `''` means
    // "not configured". For the key it means "I did not retype it", so blank
    // PRESERVES. The key is omitted entirely rather than sent as `''`, so no
    // code path can send an empty key a future server revision might read as
    // "clear it".
    ...(platformApiKey ? { platformApiKey } : {}),
  });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form || !canWrite) return;

    const ok = await save(toInput(form));
    if (ok) {
      setSavedMessage('AI settings saved');
      // The previous test described a configuration that is no longer the one
      // on screen. (Note the deliberate asymmetry with plain EDITING, which
      // does NOT clear it: reading the provider's error is precisely what the
      // administrator is doing while typing the fix.)
      clearTestResult();
    }
  };

  /**
   * Why the test button is unavailable, or `null` when it is available.
   *
   * Rendered as prose next to the button rather than left as a mysteriously
   * greyed control: "disabled with no explanation" is indistinguishable from
   * "broken", and this is the one button on the page anybody came here to
   * press.
   *
   * The dirty check is the load-bearing one: the test runs against the SAVED
   * configuration, so offering it over an edited form invites an administrator
   * to test the previous settings and believe they tested the new ones. The
   * last three branches read the SAVED values for the same reason, and are
   * separate because they fail for different reasons with different fixes.
   */
  const testBlockedReason: string | null = !canWrite
    ? 'Testing the connection needs permission to change system settings.'
    : isSaving
      ? 'Saving — wait for the save to finish, then test.'
      : isDirty
        ? 'Save your changes first. The test uses the saved configuration, not what is on screen.'
        : !settings?.provider
          ? 'No provider is configured, so there is nothing to connect to.'
          : !settings.enabled
            ? 'AI is switched off, so nothing would be called. Turn it on and save first.'
            : !settings.platformKeyStatus.configured
              ? 'No platform API key is stored. Save one first.'
              : null;

  const catalogCaption = models.fetchedAt
    ? `Fetched ${formatRelativeTime(models.fetchedAt)} · ${models.source ?? 'unknown'}`
    : 'Not fetched yet.';

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        {/* Title and description MIRROR the `AI` card in
            `config/adminSections.tsx` so the hub card, the rail row, the
            compact AppBar title and this `h1` all name the page identically. */}
        <Typography variant="h4" component="h1" gutterBottom>
          AI
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Connect OpenAI, choose which model each coaching persona uses, and test the
          connection.
          {/* Stated up front rather than left for the user to discover by
              finding every control disabled. */}
          {!canWrite && ' (read-only)'}
        </Typography>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Every user signs in with their own OpenAI key, which powers their own coaching. The
          platform key below is used only for the model list and for the test on this page.
        </Typography>

        {settings?.updatedBy && settings.updatedAt && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Last updated by {settings.updatedBy.email} on{' '}
            {new Date(settings.updatedAt).toLocaleString()}
          </Typography>
        )}

        {loadError && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {loadError}
          </Alert>
        )}

        {/* A STORED ROW THAT WOULD NOT PARSE. The API degrades rather than
            500ing, so the broken row does not take down the one screen able to
            repair it — but that means the form below shows DEFAULTS, not this
            deployment's configuration, and an administrator who is not told
            would "fix" a page that never described their system.

            `warning` rather than `error`: the red band on this page belongs to
            a load that failed and a test that failed, and this is neither —
            the page works, the data behind it does not. */}
        {settings?.settingsError && (
          <Alert severity="warning" sx={{ mb: 3 }}>
            <AlertTitle>The stored AI configuration could not be read</AlertTitle>
            {settings.settingsError}
            <Box sx={{ mt: 1 }}>
              Until it is repaired, no AI feature can run, and the fields below are defaults
              rather than your saved values. Re-enter the configuration and save to replace the
              stored row.
            </Box>
          </Alert>
        )}

        {saveError && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={clearSaveError}>
            {saveError}
          </Alert>
        )}

        {form && settings && (
          <Paper sx={{ mt: 2, p: { xs: 2, sm: 3 } }}>
            <Box component="form" onSubmit={handleSubmit} noValidate>
              {/* THE MASTER SWITCH, ABOVE THE PROVIDER AND SEPARATE FROM IT.
                  See `providerChoice` for why folding "off" into the radio
                  group would lose a state the API deliberately keeps. */}
              <FormControlLabel
                control={
                  <Switch
                    checked={form.enabled}
                    onChange={(e) => update('enabled', e.target.checked)}
                    disabled={!canWrite}
                  />
                }
                label="Enable AI features"
              />

              {!form.enabled && (
                <Alert severity="info" sx={{ mt: 1, mb: 1 }}>
                  AI is switched off — no coaching, no planning, no analysis. The configuration
                  below is kept as it is, so switching it back on needs no retyping.
                </Alert>
              )}

              <Divider sx={{ my: 3 }} />

              <FormControl sx={{ mb: 1 }}>
                <FormLabel id="ai-provider-label">Provider</FormLabel>
                {/* Row from `sm` up, column below, expressed in `sx` rather
                    than a `useMediaQuery` — pure layout, and it must not become
                    a gate. */}
                <RadioGroup
                  aria-labelledby="ai-provider-label"
                  value={providerChoice(form.provider)}
                  onChange={(e) =>
                    update(
                      'provider',
                      e.target.value === '' ? null : (e.target.value as AiProviderKind),
                    )
                  }
                  sx={{ flexDirection: { xs: 'column', sm: 'row' }, columnGap: 3 }}
                >
                  <FormControlLabel
                    value="openai"
                    control={<Radio />}
                    label="OpenAI"
                    disabled={!canWrite}
                  />
                </RadioGroup>
                <FormHelperText>
                  {form.provider === null
                    ? 'No provider has been chosen yet. Pick one to configure it.'
                    : 'Where this deployment sends its AI requests.'}
                </FormHelperText>
              </FormControl>

              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid size={{ xs: 12, sm: 8 }}>
                  <TextField
                    fullWidth
                    type={showKey ? 'text' : 'password'}
                    label="Platform API key"
                    value={platformApiKey}
                    onChange={(e) => setPlatformApiKey(e.target.value)}
                    disabled={!canWrite}
                    placeholder="Leave blank to keep the stored key"
                    // The browser must not offer to fill or store this: it is a
                    // service credential, not the administrator's own password.
                    autoComplete="off"
                    spellCheck={false}
                    helperText={describeKeyStatus(settings.platformKeyStatus)}
                    slotProps={{
                      input: {
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              onClick={() => setShowKey((v) => !v)}
                              edge="end"
                              aria-label={showKey ? 'Hide key' : 'Show key'}
                            >
                              {showKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      },
                    }}
                  />
                </Grid>
              </Grid>

              {/* ADVANCED, AND COLLAPSED. `baseUrl` exists for a proxy and for
                  the fake OpenAI server the e2e suite runs against; putting it
                  in the main flow would invite an administrator to fill in a
                  field whose correct value is almost always "empty". */}
              {/* `heading: { component: 'h2' }` because MUI wraps an
                  Accordion's summary in an `<h3>` by default, which jumps two
                  levels from this page's `<h1>` and fails axe's heading-order
                  rule. */}
              <Accordion
                elevation={0}
                disableGutters
                slotProps={{ heading: { component: 'h2' } }}
                sx={{ mt: 2, border: 1, borderColor: 'divider' }}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="body2">Advanced</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <TextField
                    fullWidth
                    label="Base URL"
                    value={form.baseUrl}
                    onChange={(e) => update('baseUrl', e.target.value)}
                    disabled={!canWrite}
                    helperText="Override only for a proxy or the test server; https is required in production. Leave blank to use the deployment default."
                  />
                </AccordionDetails>
              </Accordion>

              <Divider sx={{ my: 3 }} />

              {/* `component` is explicit throughout: MUI's `variant` picks the
                  TYPE SCALE, not the outline level, and letting it choose the
                  element produces an h1 → h6 jump that axe rejects. */}
              <Typography variant="h6" component="h2" gutterBottom>
                Models
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Only GPT 5.4 and newer are listed: earlier models cannot honour the structured
                output contract every AI call in this product depends on.
              </Typography>

              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  flexWrap: 'wrap',
                  mb: 2,
                }}
              >
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={refreshModels}
                  disabled={isRefreshingModels}
                >
                  Refresh models
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {catalogCaption}
                </Typography>
              </Box>

              {/* Inline, not a crash and not a snackbar: an empty select with
                  no explanation reads as a broken page. */}
              {models.error && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {models.error}
                </Alert>
              )}

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <FormControl fullWidth>
                    {/* `shrink`/`notched` because the Select sets
                        `displayEmpty`: without it MUI renders a blank box for
                        the `''` value, so "no default model" would look like a
                        control that failed to load. */}
                    <InputLabel id="ai-default-model-label" shrink>
                      Default model
                    </InputLabel>
                    <Select
                      labelId="ai-default-model-label"
                      label="Default model"
                      displayEmpty
                      notched
                      value={form.defaultModel ?? NO_DEFAULT}
                      disabled={!canWrite}
                      onChange={(e) =>
                        update(
                          'defaultModel',
                          e.target.value === NO_DEFAULT ? null : (e.target.value as string),
                        )
                      }
                    >
                      <MenuItem value={NO_DEFAULT}>No default model</MenuItem>
                      {/* A stored model missing from the catalog stays
                          selectable — see `PersonaModelTable`'s header for why
                          a Select whose value matches no option is worse than
                          an odd-looking one. */}
                      {form.defaultModel &&
                        !models.models.some((m) => m.id === form.defaultModel) && (
                          <MenuItem value={form.defaultModel}>
                            {form.defaultModel} (not in catalog)
                          </MenuItem>
                        )}
                      {models.models.map((model) => (
                        <MenuItem key={model.id} value={model.id}>
                          {model.id}
                        </MenuItem>
                      ))}
                    </Select>
                    <FormHelperText>
                      Used by every persona that has not been given one of its own.
                    </FormHelperText>
                  </FormControl>
                </Grid>
              </Grid>

              <Box sx={{ mt: 3 }}>
                <Typography variant="subtitle1" component="h3" gutterBottom>
                  Models by persona
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Give a persona its own model where the work justifies it. Anything left on
                  the default follows the selection above.
                </Typography>
                <PersonaModelTable
                  personas={personas}
                  models={models.models}
                  personaModels={form.personaModels}
                  defaultModel={form.defaultModel}
                  disabled={!canWrite}
                  onChange={setPersonaModel}
                />
              </Box>

              <Divider sx={{ my: 3 }} />

              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  flexWrap: 'wrap',
                }}
              >
                <Button type="submit" variant="contained" disabled={!canWrite || isSaving}>
                  {isSaving ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<BoltIcon />}
                  onClick={test}
                  disabled={isTesting || testBlockedReason !== null}
                >
                  {isTesting ? 'Testing…' : 'Test connection'}
                </Button>
                {testBlockedReason && (
                  <Typography variant="body2" color="text.secondary">
                    {testBlockedReason}
                  </Typography>
                )}
              </Box>

              {/* THE DIAGNOSTIC SURFACE. Persistent and dismissible, not a
                  snackbar: `Incorrect API key provided: sk-***` and
                  `The model gpt-5.4 does not exist or you do not have access to
                  it` are the entire reason an administrator opened this page,
                  and neither fits in a toast.

                  Driven by `testResult.success` and never by "the call
                  resolved" — the endpoint answers 200 for a refused connection,
                  and that refusal IS the diagnosis. */}
              {testResult && (
                <Box
                  component="section"
                  aria-label="Test result"
                  role={testResult.success ? 'status' : 'alert'}
                >
                  <Alert
                    severity={testResult.success ? 'success' : 'error'}
                    sx={{ mt: 3 }}
                    onClose={clearTestResult}
                  >
                    {testResult.success ? (
                      <>
                        <AlertTitle>Connection works</AlertTitle>
                        {testResult.providerKind === 'openai' ? 'OpenAI' : 'The provider'}
                        {testResult.model ? ` answered on ${testResult.model}` : ' answered'}
                        {typeof testResult.latencyMs === 'number'
                          ? ` in ${testResult.latencyMs} ms`
                          : ''}
                        .
                        {testResult.checks && (
                          <Box sx={{ mt: 1 }}>
                            Checks: models {testResult.checks.listModels} · generate{' '}
                            {testResult.checks.generate}
                            {testResult.checks.generate === 'skipped' && (
                              <> — choose a default model above to exercise it.</>
                            )}
                          </Box>
                        )}
                      </>
                    ) : (
                      <>
                        <AlertTitle>Test failed</AlertTitle>
                        {testResult.checks && (
                          <Box sx={{ mb: 1 }}>
                            Checks: models {testResult.checks.listModels} · generate{' '}
                            {testResult.checks.generate}
                          </Box>
                        )}
                        {/* VERBATIM, in monospace, wrapping rather than
                            truncating. Provider errors carry codes and model
                            names that are the diagnosis; an ellipsis in the
                            middle of one costs the administrator the answer.
                            `wordBreak` keeps a long unbroken token from
                            widening the page on a phone. */}
                        <Box
                          component="pre"
                          sx={{
                            m: 0,
                            fontFamily: 'monospace',
                            fontSize: '0.8125rem',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {testResult.error ??
                            'The provider reported a failure with no message.'}
                        </Box>
                      </>
                    )}
                  </Alert>
                </Box>
              )}
            </Box>
          </Paper>
        )}

        {/* Saving is the ordinary, expected outcome, so it gets the same
            transient snackbar the sibling settings pages use. The test result
            deliberately does NOT — see above. */}
        <Snackbar
          open={!!savedMessage}
          autoHideDuration={3000}
          onClose={() => setSavedMessage(null)}
          message={savedMessage}
        />
      </Box>
    </Container>
  );
}
