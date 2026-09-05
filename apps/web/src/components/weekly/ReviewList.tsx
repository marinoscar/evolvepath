import { Box, List, ListItem, ListItemText, Typography } from '@mui/material';

/**
 * One of the review's plain lists (PRD §51): What worked, What got in the way,
 * Keep unchanged, Not yet.
 *
 * The heading is an `h2` so a screen reader can jump between the sections in
 * the order PRD §51 fixes them.
 */
export default function ReviewList({
  title,
  items,
  emptyText,
  testId,
}: {
  title: string;
  items: string[];
  emptyText?: string;
  testId?: string;
}) {
  if (items.length === 0 && !emptyText) return null;

  return (
    <Box sx={{ mt: 3 }} data-testid={testId}>
      <Typography variant="h6" component="h2" gutterBottom>
        {title}
      </Typography>

      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {emptyText}
        </Typography>
      ) : (
        <List dense disablePadding>
          {items.map((item) => (
            <ListItem key={item} disableGutters sx={{ display: 'list-item', ml: 3, p: 0 }}>
              <ListItemText primary={item} />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
}
