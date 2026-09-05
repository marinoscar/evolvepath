import { useState } from 'react';
import { Chip, Menu, MenuItem } from '@mui/material';

import type { Domain, DomainMode, DomainModeKind } from '../../types';
import { DOMAIN_LABELS } from '../../types';

interface DomainModeChipProps {
  domain: Domain;
  mode: DomainMode;
  onChange: (mode: DomainModeKind) => void;
}

const MODES: Array<{ value: DomainModeKind; label: string; help: string }> = [
  { value: 'GROW', label: 'Grow', help: 'Push forward here' },
  { value: 'MAINTAIN', label: 'Maintain', help: 'Hold the line' },
  { value: 'RECOVER', label: 'Recover', help: 'Ease off deliberately' },
  { value: 'PAUSE', label: 'Pause', help: 'Not now' },
];

const MODE_COLORS: Record<DomainModeKind, 'success' | 'info' | 'warning' | 'default'> = {
  GROW: 'success',
  MAINTAIN: 'info',
  RECOVER: 'warning',
  PAUSE: 'default',
};

/**
 * The posture for one domain (PRD §49) — a chip that opens a menu.
 *
 * The chip's label is the MODE NAME, never a colour alone, and the button
 * announces which domain it changes: four identical "Change mode" buttons on
 * one screen are four buttons a screen-reader user cannot tell apart.
 */
export function DomainModeChip({ domain, mode, onChange }: DomainModeChipProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const current = MODES.find((entry) => entry.value === mode.mode) ?? MODES[0];

  return (
    <>
      <Chip
        label={current.label}
        size="small"
        color={MODE_COLORS[mode.mode]}
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-haspopup="menu"
        aria-label={`${DOMAIN_LABELS[domain]} mode: ${current.label}. Change`}
        data-testid={`domain-mode-${domain}`}
      />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {MODES.map((entry) => (
          <MenuItem
            key={entry.value}
            selected={entry.value === mode.mode}
            onClick={() => {
              setAnchor(null);
              if (entry.value !== mode.mode) onChange(entry.value);
            }}
          >
            {entry.label} — {entry.help}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export default DomainModeChip;
