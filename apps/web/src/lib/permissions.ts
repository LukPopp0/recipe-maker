import type { CurrentUser } from 'shared';

// Mirrors the server rule (deployment spec section 4): the owner or an admin
// may delete. The server enforces it; this only hides buttons that would 403.
export function canDeleteRecipe(user: CurrentUser | null, owner: string): boolean {
  return user !== null && (user.isAdmin || user.username === owner);
}
