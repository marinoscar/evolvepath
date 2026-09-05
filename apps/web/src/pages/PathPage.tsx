import { Box, Card, CardContent, Container, Typography } from '@mui/material';

/**
 * Path — the placeholder E02-06 (#56) replaces wholesale with the Best Self
 * card, the outcome sections and the plan-version history.
 */
export default function PathPage() {
  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Path
        </Typography>

        <Card data-testid="path-placeholder" sx={{ mt: 3 }}>
          <CardContent>
            <Typography color="text.secondary">
              Best Self, outcomes and plans live here.
            </Typography>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
}
