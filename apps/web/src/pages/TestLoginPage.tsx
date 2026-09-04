import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  FormControlLabel,
  useTheme,
} from '@mui/material';

export default function TestLoginPage() {
  const theme = useTheme();

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.palette.background.default,
        p: 2,
      }}
    >
      <Card
        sx={{
          maxWidth: 400,
          width: '100%',
          boxShadow: theme.shadows[10],
        }}
      >
        <CardContent sx={{ p: 4 }}>
          {/* Warning Banner */}
          <Alert severity="warning" sx={{ mb: 3 }}>
            Test Login - Development Only
          </Alert>

          {/* Header */}
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <Typography variant="h5" component="h1" sx={{ fontWeight: 'bold' }}>
              Test Authentication
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Bypass OAuth for testing
            </Typography>
          </Box>

          {/* Form */}
          <form method="POST" action="/api/auth/test/login">
            <TextField
              name="email"
              label="Email"
              type="email"
              required
              fullWidth
              margin="normal"
              slotProps={{ htmlInput: { 'data-testid': 'test-email-input' } }}
            />

            <FormControl fullWidth margin="normal">
              <InputLabel>Role</InputLabel>
              <Select
                name="role"
                defaultValue="viewer"
                label="Role"
                data-testid="test-role-select"
              >
                <MenuItem value="admin">Admin</MenuItem>
                <MenuItem value="contributor">Contributor</MenuItem>
                <MenuItem value="viewer">Viewer</MenuItem>
              </Select>
            </FormControl>

            <TextField
              name="displayName"
              label="Display Name (optional)"
              fullWidth
              margin="normal"
            />

            {/*
              Seeds an OpenAI key on the test user so the login lands on the
              app instead of `/setup/ai-key` (#25, epic #20).

              UNCHECKED BY DEFAULT, deliberately: the keyless path is the one
              worth being able to reach by hand, because it is the first thing
              a real user sees. The e2e helper defaults the flag to `true` in
              the opposite direction, so existing specs keep landing on `/`.

              A NATIVE FORM POST, so this arrives as the string 'on' rather
              than a boolean — see the `preprocess` on TestLoginDto.
            */}
            <FormControlLabel
              control={
                <Checkbox name="withAiKey" data-testid="test-with-ai-key" />
              }
              label="Seed an OpenAI key (skip the setup gate)"
              sx={{ mt: 1 }}
            />

            <Button
              type="submit"
              variant="contained"
              fullWidth
              sx={{ mt: 3 }}
              data-testid="test-login-button"
            >
              Login as Test User
            </Button>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
