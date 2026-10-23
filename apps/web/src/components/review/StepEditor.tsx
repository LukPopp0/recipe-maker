// One editable block per step: step_header input, step_description textarea
// (600 maxlength + live character count), the step image (ImageControl when a
// namespace is given, else a plain thumbnail)
// with paste / link / upload / remove (paste / link / upload / remove, docs/specs/14), and a remove button (disabled
// at the 1-step floor). "Add step" is disabled at the 6-step cap (docs/specs/02
// rule 9) with an explanatory hint. All updates are immutable - every
// callback builds a fresh array/object.
import type { Step } from 'shared';
import { ImageControl } from './ImageControl.tsx';

const MAX_STEPS = 6;
const MIN_STEPS = 1;
const DESCRIPTION_MAXLENGTH = 600;

export function StepEditor({
  steps,
  onChange,
  readOnly = false,
  imageNamespaceId,
  onImageChange,
}: {
  steps: Step[]
  onChange: (steps: Step[]) => void
  readOnly?: boolean
  // Storage namespace for step images; the image control is only rendered
  // when this is provided.
  imageNamespaceId?: string
  // Called with the hosted URL (or null on remove) for the step at index.
  onImageChange?: (index: number, url: string | null) => void
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
              <img
                className="step-editor-image-thumb"
                data-testid="step-image-thumb"
                src={step.image}
                alt={`Step ${index + 1}`}
              />
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
          {!imageNamespaceId && step.image ? (
            <img
              className="step-editor-image-thumb"
              data-testid="step-image-thumb"
              src={step.image}
              alt={`Step ${index + 1}`}
            />
          ) : null}
          {imageNamespaceId ? (
            <ImageControl
              label={`Step ${index + 1} image`}
              slot={index}
              imageUrl={step.image ?? null}
              namespaceId={imageNamespaceId}
              onChange={(url) => onImageChange?.(index, url)}
              removeLabel={`Remove image from step ${index + 1}`}
            />
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => removeStep(index)}
            aria-label={`Remove step ${index + 1}`}
            disabled={atFloor}
          >
            Remove step
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" onClick={addStep} disabled={atCap}>
        Add step
      </button>
      {atCap ? <p className="step-editor-cap-hint">Recipes support a max 6 steps.</p> : null}
    </div>
  );
}
