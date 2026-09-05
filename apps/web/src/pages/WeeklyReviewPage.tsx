import { useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Container,
  Grid,
  IconButton,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';

import PatternCard from '../components/weekly/PatternCard';
import ReviewList from '../components/weekly/ReviewList';
import ReviewProposalCard from '../components/weekly/ReviewProposalCard';
import TemplateSummaryNotice from '../components/weekly/TemplateSummaryNotice';
import WeekDomainTiles from '../components/weekly/WeekDomainTiles';
import { useWeeklyReview } from '../hooks/useWeeklyReview';
import { formatDay } from '../components/weekly/ExtraCommitmentDialog';
import { weekDatesFrom } from '../components/weekly/WeeklyPlanWizard';

/**
 * Your Week (`/progress/week`) — PRD §51's screen, in PRD §51's order.
 *
 * Under `progress` rather than at `/review`, and not a sixth destination: the
 * review is the weekly view of progress, so it lives under the tab that lights
 * up for it, and `DESTINATION_ROUTES.progress` already owns `/progress/*` by
 * prefix — no registry change at all.
 *
 * READ-MOSTLY (VISION §20). Every mutation goes through the hook's API call
 * and then a reload, so the screen never shows a state the server has not
 * persisted.
 */
export default function WeeklyReviewPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const weekStart = params.get('weekStart') ?? undefined;

  const {
    review,
    isLoading,
    isGenerating,
    error,
    outcomes,
    pendingProposalId,
    generate,
    skip,
    accept,
    edit,
    reject,
  } = useWeeklyReview(weekStart);

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const summary = review?.aiSummary;
  const patterns = summary?.patterns ?? [];
  const approved = review?.status === 'APPROVED';

  const shiftWeek = (weeks: number) => {
    const from = review?.weekStart ?? weekStart;
    if (!from) return;

    const [year, month, day] = from.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day) + weeks * 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    setParams({ weekStart: shifted });
  };

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <Stack
          direction="row"
          sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}
        >
          <div>
            <Typography variant="h4" component="h1" gutterBottom>
              Your Week
            </Typography>
            {review && (
              <Typography variant="body2" color="text.secondary">
                {weekRange(review.weekStart)}
              </Typography>
            )}
          </div>

          <Stack direction="row" sx={{ alignItems: 'center' }}>
            <IconButton aria-label="Previous week" onClick={() => shiftWeek(-1)}>
              <ChevronLeftIcon />
            </IconButton>
            <IconButton aria-label="Next week" onClick={() => shiftWeek(1)}>
              <ChevronRightIcon />
            </IconButton>
            <IconButton
              aria-label="More actions"
              onClick={(event) => setMenuAnchor(event.currentTarget)}
            >
              <MoreVertIcon />
            </IconButton>
          </Stack>
        </Stack>

        <Menu
          anchorEl={menuAnchor}
          open={menuAnchor !== null}
          onClose={() => setMenuAnchor(null)}
        >
          <MenuItem
            // An approved week was closed by a plan somebody acted on;
            // rewriting the review it was approved against would make the
            // record a lie.
            disabled={approved || isGenerating}
            onClick={() => {
              setMenuAnchor(null);
              void generate();
            }}
          >
            Regenerate
          </MenuItem>
          <MenuItem
            disabled={review?.status !== 'READY'}
            onClick={() => {
              setMenuAnchor(null);
              void skip();
            }}
          >
            Skip this week
          </MenuItem>
        </Menu>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {isLoading && <Skeleton variant="rounded" height={140} sx={{ mt: 3 }} />}

        {!isLoading && !review && (
          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Typography color="text.secondary">
                No review for this week yet.
              </Typography>
            </CardContent>
            <CardActions>
              <Button
                variant="contained"
                data-testid="review-generate"
                disabled={isGenerating}
                onClick={() => void generate()}
              >
                {isGenerating ? 'Preparing your week…' : 'Generate review'}
              </Button>
            </CardActions>
          </Card>
        )}

        {review?.status === 'GENERATING' && (
          <Box sx={{ mt: 3 }}>
            <Typography color="text.secondary" gutterBottom>
              Preparing your week…
            </Typography>
            <Skeleton variant="rounded" height={140} />
          </Box>
        )}

        {review && review.status !== 'GENERATING' && (
          <Grid container spacing={3} sx={{ mt: 0 }}>
            <Grid size={{ xs: 12, md: 7 }}>
              <WeekDomainTiles aggregates={review.aggregates} />

              {summary?.source === 'template' && <TemplateSummaryNotice />}

              <ReviewList
                title="What worked"
                items={summary?.whatWorked ?? []}
                emptyText="Nothing stood out this week."
                testId="review-what-worked"
              />
              <ReviewList
                title="What got in the way"
                items={summary?.whatDidNot ?? []}
                emptyText="Nothing got in the way."
                testId="review-what-did-not"
              />

              <Box sx={{ mt: 3 }}>
                <Typography variant="h6" component="h2" gutterBottom>
                  Pattern
                </Typography>

                {patterns.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    Not enough of a pattern to name yet.
                  </Typography>
                ) : (
                  <>
                    <PatternCard pattern={patterns[0]} />

                    {patterns.length > 1 && (
                      <Accordion sx={{ mt: 1 }}>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                          More patterns
                        </AccordionSummary>
                        <AccordionDetails>
                          <Stack spacing={1}>
                            {patterns.slice(1).map((pattern) => (
                              <PatternCard key={pattern.observation} pattern={pattern} />
                            ))}
                          </Stack>
                        </AccordionDetails>
                      </Accordion>
                    )}
                  </>
                )}
              </Box>
            </Grid>

            <Grid size={{ xs: 12, md: 5 }}>
              <Typography variant="h6" component="h2" gutterBottom>
                Recommendation
              </Typography>

              {review.proposals.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No plan change recommended this week.
                </Typography>
              ) : (
                <Stack spacing={2}>
                  {review.proposals.map((proposal) => (
                    <ReviewProposalCard
                      key={proposal.id}
                      proposal={proposal}
                      outcome={outcomes[proposal.id]}
                      busy={pendingProposalId === proposal.id}
                      onAccept={(id) => void accept(id)}
                      onEdit={(id, changes) => void edit(id, changes)}
                      onReject={(id) => void reject(id)}
                    />
                  ))}
                </Stack>
              )}

              <ReviewList
                title="Keep unchanged"
                items={summary?.keepUnchanged ?? []}
                testId="review-keep-unchanged"
              />
              <ReviewList
                title="Not yet"
                items={summary?.doNotAddYet ?? []}
                testId="review-not-yet"
              />

              <Box sx={{ mt: 3 }}>
                <Typography variant="h6" component="h2" gutterBottom>
                  Next week
                </Typography>

                {review.plan?.status === 'APPROVED' ? (
                  <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
                    <Typography variant="body2">Next week approved.</Typography>
                    <Button component={RouterLink} to="/path">
                      See it on your Path
                    </Button>
                  </Stack>
                ) : (
                  <Button
                    variant="contained"
                    data-testid="review-approve-next-week"
                    onClick={() => navigate('/progress/week/plan')}
                  >
                    {review.plan ? 'Continue planning' : 'Approve next week'}
                  </Button>
                )}
              </Box>
            </Grid>
          </Grid>
        )}
      </Box>
    </Container>
  );
}

/** "Mon 31 Aug – Sun 6 Sep". Never `new Date('YYYY-MM-DD')`. */
function weekRange(weekStart: string): string {
  const dates = weekDatesFrom(weekStart);

  return `${formatDay(dates[0])} – ${formatDay(dates[6])}`;
}
