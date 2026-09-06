import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ReplayIcon from '@mui/icons-material/Replay';
import RouteIcon from '@mui/icons-material/Route';
import TimelapseIcon from '@mui/icons-material/Timelapse';
import { Link as RouterLink } from 'react-router-dom';

import type { TimelineEvent, TimelineKind } from '../../types';

/**
 * What actually happened (issue #117, epic E11).
 *
 * PRD §77 asks for celebrations that match significance, and this is where that
 * is expressed: three visual weights, none of which is colour alone (PRD §122).
 * A milestone gets a trophy, a bold title and a "Milestone" chip; a notable
 * event gets a star and a left border; an ordinary one is plain text.
 *
 * The rows are whatever the server sent. There is no client-side filtering of
 * what counts as meaningful — that decision lives in one place, and it is the
 * builder.
 */

const KIND_ICONS: Record<TimelineKind, typeof CheckCircleIcon> = {
  completed: CheckCircleIcon,
  completed_fallback: CheckCircleIcon,
  partially_completed: TimelapseIcon,
  started_after_postpone: PlayArrowIcon,
  family_kept: FavoriteBorderIcon,
  returned_after_miss: ReplayIcon,
  plan_change_accepted: RouteIcon,
  comeback_completed: ReplayIcon,
  milestone: EmojiEventsIcon,
};

/** How many rows the Progress page's compact strip shows. */
export const COMPACT_TIMELINE_ROWS = 8;

interface Props {
  items: TimelineEvent[];
  compact?: boolean;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  /**
   * What level the day labels sit at.
   *
   * `h3` under the Progress page's "Evidence" `h2`, `h2` on the standalone
   * timeline page whose only other heading is the `h1`. A fixed level would
   * skip one on whichever page it was wrong for, which axe fails and a screen
   * reader user experiences as a missing section.
   */
  dayHeadingLevel?: 'h2' | 'h3';
}

function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

/** Groups preserve the incoming order, which is already newest-first. */
function groupByDay(items: TimelineEvent[]): Array<[string, TimelineEvent[]]> {
  const groups = new Map<string, TimelineEvent[]>();

  for (const item of items) {
    const key = dayLabel(item.at);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  return [...groups.entries()];
}

export default function EvidenceTimeline({
  items,
  compact = false,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  dayHeadingLevel = 'h3',
}: Props) {
  const shown = compact ? items.slice(0, COMPACT_TIMELINE_ROWS) : items;
  const groups = groupByDay(shown);

  if (items.length === 0) {
    return (
      <Card>
        <CardContent>
          <Typography color="text.secondary">
            What you do will appear here, newest first.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="progress-timeline">
      <CardContent>
        <Stack spacing={2} divider={<Divider flexItem />}>
          {groups.map(([day, events]) => (
            <Box key={day}>
              <Typography
                variant="overline"
                color="text.secondary"
                component={dayHeadingLevel}
                sx={{ display: 'block' }}
              >
                {day}
              </Typography>

              <Stack component="ul" spacing={1} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {events.map((event) => {
                  const Icon = KIND_ICONS[event.kind];
                  const isMilestone = event.significance === 'milestone';
                  const isNotable = event.significance === 'notable';

                  return (
                    <Box
                      key={event.id}
                      component="li"
                      data-testid={`timeline-${event.significance}`}
                      sx={{
                        display: 'flex',
                        gap: 1.5,
                        alignItems: 'flex-start',
                        // The border is a second, redundant carrier — the icon
                        // and the chip already say it (PRD §122).
                        borderLeft: isNotable || isMilestone ? 3 : 0,
                        borderColor: isMilestone ? 'primary.main' : 'divider',
                        pl: isNotable || isMilestone ? 1.5 : 0,
                      }}
                    >
                      <Icon
                        fontSize="small"
                        aria-hidden
                        color={isMilestone ? 'primary' : 'action'}
                        sx={{ mt: 0.25 }}
                      />
                      <Box sx={{ minWidth: 0 }}>
                        <Box
                          sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}
                        >
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: isMilestone ? 600 : 400 }}
                          >
                            {event.title}
                          </Typography>
                          {isMilestone && <Chip size="small" label="Milestone" />}
                        </Box>
                        {event.detail && (
                          <Typography variant="caption" color="text.secondary">
                            {event.detail}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            </Box>
          ))}
        </Stack>

        {compact && (
          <Box sx={{ mt: 2 }}>
            <MuiLink component={RouterLink} to="/progress/timeline">
              See all
            </MuiLink>
          </Box>
        )}

        {!compact && hasMore && onLoadMore && (
          <Box sx={{ mt: 2 }}>
            <Button onClick={onLoadMore} disabled={isLoadingMore}>
              {isLoadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
