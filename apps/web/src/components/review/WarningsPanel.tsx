// Non-blocking notices surfaced from recipe.metadata.warnings. Visually
// distinct from FieldErrors (which are blocking validation errors) via
// --color-warning styling. Renders nothing when there are no warnings.
export function WarningsPanel({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;

  return (
    <ul className="warnings-panel" role="status">
      {warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  );
}
