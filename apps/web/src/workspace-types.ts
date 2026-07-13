// Workspace-level types shared across App.tsx and the ingest/review/json
// component trees. Recipe/error shapes are imported from api/client.ts and
// shared, never redefined here.
import type { ApiFailure, IngestDiagnostics } from './api/client.ts';
import type { CanonicalRecipe } from 'shared';

// Lifecycle of a single ingestion attempt (URL, Manual, or Load JSON tab).
// Stages are honest client-side lifecycle points, not simulated backend
// progress (plan decision 7).
export type IngestStatus =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'processing'; message: string }
  | { phase: 'complete' }
  | { phase: 'error'; error: ApiFailure };

// The recipe currently loaded into the review panel, or null if nothing has
// been ingested/loaded yet. `dirty` tracks unsaved edits made in the review
// panel; `savedId` is set once the user explicitly saves via /api/recipe/save.
export type WorkspaceRecipeState = {
  recipe: CanonicalRecipe
  diagnostics: IngestDiagnostics | null
  savedId: string | null
  dirty: boolean
  // Storage-key namespace review-panel step-image uploads go into. Comes from
  // the ingest response when available; minted client-side for recipes that
  // never went through ingestion (Load JSON, Open in Create).
  imageNamespaceId: string
} | null;

// Replacing the loaded recipe (fresh ingestion or Load JSON) discards any
// unsaved edits, so App.tsx confirms first when this returns true (plan
// decision 12). Only unsaved dirty state needs a confirmation - once saved,
// the recipe is recoverable from the library.
export function shouldConfirmReplace(state: WorkspaceRecipeState): boolean {
  return state !== null && state.dirty && state.savedId === null;
}
