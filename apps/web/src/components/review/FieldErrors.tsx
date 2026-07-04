// Renders a zod flatten() error payload: top-level form errors first, then
// each field's errors grouped under its field path. Shared by the Load JSON
// tab (server validate response) and the review panel's client-side
// safeParse errors (Task 10), both of which produce the same shape.
import type { FlattenedErrors } from '../../api/client.ts';

export function FieldErrors({ formErrors, fieldErrors }: FlattenedErrors) {
  const fieldEntries = Object.entries(fieldErrors);

  return (
    <div className="field-errors" role="alert">
      {formErrors.length > 0 ? (
        <ul className="field-errors-form">
          {formErrors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
      {fieldEntries.length > 0 ? (
        <ul className="field-errors-fields">
          {fieldEntries.map(([field, messages]) => (
            <li key={field}>
              <span className="field-errors-field-name">{field}</span>
              <ul>
                {messages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
