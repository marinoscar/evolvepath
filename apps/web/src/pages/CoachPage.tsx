import { Box, Card, CardContent, Container, Typography } from '@mui/material';

/** Coach — the destination exists now; its content arrives with E06. */
export default function CoachPage() {
  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Coach
        </Typography>

        <Card data-testid="coach-placeholder" sx={{ mt: 3 }}>
          <CardContent>
            <Typography color="text.secondary">
              Your coach arrives with a later release.
            </Typography>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
}
