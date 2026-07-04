// One editable block per step: step_header input, step_description textarea
// (600 maxlength + live character count), a read-only indicator when a step
// image is set (step images are assigned during ingestion and never edited
// here), and a remove button (disabled at the 1-step floor). "Add step" is
// disabled at the 6-step cap (specs/02 rule 9) with an explanatory hint.
// All updates are immutable - every callback builds a fresh array/object.
import type { Step } from 'shared';

const MAX_STEPS = 6;
const MIN_STEPS = 1;
const DESCRIPTION_MAXLENGTH = 600;

export function StepEditor({
  steps,
  onChange,
  readOnly = false,
}: {
  steps: Step[]
  onChange: (steps: Step[]) => void
  readOnly?: boolean
}) {
  const updateField = (index: number, field: 'step_header' | 'step_description', value: string) => {
    onChange(steps.map((step, i) => (i === index ? { ...step, [field]: value } : step)));
  };

  const removeStep = (index: number) => {
    onChange(steps.filter((_, i) => i !== index));
  };

  const addStep = () => {
    onChange([...steps, { step_header: '', step_description: '' }]);
  };

  const atCap = steps.length >= MAX_STEPS;
  const atFloor = steps.length <= MIN_STEPS;

  if (readOnly) {
    return (
      <div className="step-editor">
        {steps.map((step, index) => (
          <div className="step-editor-block" key={index}>
            <h4 className="step-editor-static-header">{step.step_header}</h4>
            <p className="step-editor-static-description">{step.step_description}</p>
            {step.image ? (
              <span className="step-editor-image-indicator" data-testid="step-image-indicator">
                Image attached: {step.image}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="step-editor">
      {steps.map((step, index) => (
        <div className="step-editor-block" key={index}>
          <label>
            <span>Step header</span>
            <input
              type="text"
              value={step.step_header}
              onChange={(event) => updateField(index, 'step_header', event.target.value)}
            />
          </label>
          <label>
            <span>Step description</span>
            <textarea
              maxLength={DESCRIPTION_MAXLENGTH}
              value={step.step_description}
              onChange={(event) => updateField(index, 'step_description', event.target.value)}
            />
          </label>
          <span className="step-editor-char-count">
            {step.step_description.length} / {DESCRIPTION_MAXLENGTH}
          </span>
          {step.image ? (
            <span className="step-editor-image-indicator" data-testid="step-image-indicator">
              Image attached: {step.image}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => removeStep(index)}
            aria-label={`Remove step ${index + 1}`}
            disabled={atFloor}
          >
            Remove step
          </button>
        </div>
      ))}
      <button type="button" onClick={addStep} disabled={atCap}>
        Add step
      </button>
      {atCap ? <p className="step-editor-cap-hint">Recipes support a max 6 steps.</p> : null}
    </div>
  );
}
