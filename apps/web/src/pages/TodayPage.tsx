import { Box, Button, Card, CardContent, Container, Typography } from '@mui/material';
import { Link } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import { greetingFor } from '../utils/greeting';

/**
 * Today — VISION Part VII §27's "most important screen", as a placeholder.
 *
 * A greeting and an empty state, and no data fetching at all: the
 * next-best-action engine and the domain cards arrive in E05. What this page
 * has to do NOW is give a new user somewhere to go, which is why the empty
 * state is a link to Path rather than a shrug.
 */
export default function TodayPage() {
  const { user } = useAuth();
  const greeting = greetingFor(new Date().getHours());

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Good {greeting}, {user?.displayName ?? 'there'}
        </Typography>

        <Card data-testid="today-empty-state" sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6" component="h2" gutterBottom>
              Your Path is empty
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Add your first outcome and the Today screen fills itself.
            </Typography>
            <Button component={Link} to="/path" variant="contained">
              Go to Path
            </Button>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
}
