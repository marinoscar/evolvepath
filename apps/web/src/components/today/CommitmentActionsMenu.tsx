import { Menu, MenuItem } from '@mui/material';

import type { FamilyRowAction } from '../family/familyLabels';
import { ACTION_LABELS, type RowAction } from './todayLabels';

interface CommitmentActionsMenuProps {
  anchorEl: HTMLElement | null;
  actions: FamilyRowAction[];
  /**
   * How to word each action. Defaults to the generic vocabulary; the Family
   * domain passes one that says "Move it" where this says "Reschedule"
   * (epic E08). LABELS only — the list itself still comes from the server.
   */
  labelFor?: (action: FamilyRowAction) => string;
  onClose: () => void;
  onSelect: (action: FamilyRowAction) => void;
}

/**
 * RENDERS EXACTLY WHAT THE API SENT.
 *
 * `availableActions` is computed server-side from the transition matrix plus the
 * timer, and this menu maps it to labels and nothing more. It does not filter,
 * reorder or add — an item this menu invented would be a button the API refuses,
 * and the user would be the one to discover it.
 *
 * The ONE exception is `edit`, which is not an action endpoint at all: it maps
 * to `PATCH /commitments/:id`, whose own rules (409 on a terminal row) the
 * caller applies before putting it in this list.
 */
export function CommitmentActionsMenu({
  anchorEl,
  actions,
  labelFor = (action) => ACTION_LABELS[action as RowAction],
  onClose,
  onSelect,
}: CommitmentActionsMenuProps) {
  return (
    <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={onClose}>
      {actions.map((action) => (
        <MenuItem
          key={action}
          onClick={() => {
            onClose();
            onSelect(action);
          }}
        >
          {labelFor(action)}
        </MenuItem>
      ))}
    </Menu>
  );
}
