import { useState } from 'react';
import { Alert, Box, Button, CircularProgress, TextField, Typography } from '@mui/material';

import { mealCheck } from '../../services/api';
import type { MealCheckResult } from '../../types';
import { MediaCapture } from '../health/media/MediaCapture';
import { MealCheckResultCard } from '../health/media/HealthMediaResultCard';
import { useNutritionBehaviours } from '../../hooks/useNutritionBehaviours';

interface MealCheckPanelProps {
  onDone: () => void;
}

/**
 * "Meal check", from Today's quick add (issue #111, epic E09).
 *
 * A suggestion becomes a real HEALTH commitment through the SAME
 * behaviour-commit endpoint the `/health` screen uses — not a bespoke create
 * call — so a habit that arrived from a photograph is indistinguishable from
 * one the user picked off a list. It is the same habit.
 */
export function MealCheckPanel({ onDone }: MealCheckPanelProps) {
  const { commit } = useNutritionBehaviours();

  const [storageObjectId, setStorageObjectId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<MealCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const check = async () => {
    if (!storageObjectId) return;

    setChecking(true);
    setError(null);

    try {
      const response = await mealCheck({
        storageObjectId,
        question: question.trim() || undefined,
      });

      if (response.ok) setResult(response.result);
      else setError(response.error.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setChecking(false);
    }
  };

  const addBehaviour = async (key: string) => {
    try {
      await commit(key, 1);
      setAdded(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that.');
    }
  };

  return (
    <Box>
      {result ? (
        <>
          <MealCheckResultCard
            result={result}
            onAddBehaviour={(key) => void addBehaviour(key)}
          />
          {added ? (
            <Alert severity="success" sx={{ mt: 2 }}>
              Added to today.
            </Alert>
          ) : null}
          <Button sx={{ mt: 2 }} onClick={onDone}>
            Done
          </Button>
        </>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            A photo of what you are about to eat. I look at habits, not calories.
          </Typography>

          <MediaCapture
            label="Photograph your meal"
            accept="image/*"
            capture="environment"
            disabled={checking}
            onUploaded={(id) => setStorageObjectId(id)}
          />

          <TextField
            label="Anything you want to ask?"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            fullWidth
            size="small"
            sx={{ mt: 2 }}
            slotProps={{ htmlInput: { maxLength: 300 } }}
          />

          {storageObjectId ? (
            <Button
              variant="contained"
              sx={{ mt: 2, minHeight: 44 }}
              disabled={checking}
              onClick={() => void check()}
              startIcon={checking ? <CircularProgress size={16} /> : undefined}
            >
              Check
            </Button>
          ) : null}
        </>
      )}

      {error ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      ) : null}
    </Box>
  );
}
