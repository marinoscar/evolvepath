import { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';

import { equipmentCheck } from '../../../services/api';
import type { Equipment, EquipmentCheckResult } from '../../../types';
import { MediaCapture } from '../../health/media/MediaCapture';
import { EquipmentCheckResultCard } from '../../health/media/HealthMediaResultCard';

interface EquipmentPhotoStepProps {
  /** Present on the program page; absent in the builder, where no program exists yet. */
  programId?: string;
  /** Called with what the photo found. The caller decides what to do with it. */
  onDetected?: (equipment: Equipment[]) => void;
}

/**
 * "Photograph your equipment" (issue #111, epic E09).
 *
 * THE RESULT NEVER OVERRIDES A MANUAL CHOICE. In the builder it PRE-SELECTS
 * chips the user can still change: a photograph of one corner of a garage is
 * evidence, not an inventory, and a user who knows there are kettlebells in the
 * cupboard should not have to argue with a camera.
 *
 * On the program page the same component passes `programId`, and the API
 * answers with substitutions plus the proposal it raised — which changes
 * nothing until the user accepts it (PRD §15).
 */
export function EquipmentPhotoStep({ programId, onDetected }: EquipmentPhotoStepProps) {
  const [storageObjectId, setStorageObjectId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<EquipmentCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async (objectId: string) => {
    setChecking(true);
    setError(null);

    try {
      const response = await equipmentCheck({ storageObjectId: objectId, programId });

      if (response.ok) {
        setResult(response.result);
        onDetected?.(response.result.equipmentDetected);
      } else {
        setError(response.error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Or photograph the room and I will fill this in. You can still change anything I get wrong.
      </Typography>

      <MediaCapture
        label="Photograph your equipment"
        accept="image/*"
        capture="environment"
        disabled={checking}
        onUploaded={(id) => {
          setStorageObjectId(id);
          void check(id);
        }}
      />

      {checking ? (
        <Box sx={{ mt: 2 }} role="status">
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary" component="span" sx={{ ml: 1 }}>
            Looking at the photo…
          </Typography>
        </Box>
      ) : null}

      {result ? (
        <Box sx={{ mt: 2 }}>
          <EquipmentCheckResultCard result={result} />
        </Box>
      ) : null}

      {error ? (
        <Alert
          severity="error"
          sx={{ mt: 2 }}
          action={
            storageObjectId ? (
              <Button size="small" onClick={() => void check(storageObjectId)}>
                Try again
              </Button>
            ) : undefined
          }
        >
          {error}
        </Alert>
      ) : null}
    </Box>
  );
}
