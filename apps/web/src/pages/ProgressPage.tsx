import { Box, Card, CardContent, Container, Typography } from '@mui/material';

/** Progress — the destination exists now; momentum and charts arrive with E11. */
export default function ProgressPage() {
  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Progress
        </Typography>

        <Card data-testid="progress-placeholder" sx={{ mt: 3 }}>
          <CardContent>
            <Typography color="text.secondary">
              Momentum and evidence will appear here.
            </Typography>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
}
