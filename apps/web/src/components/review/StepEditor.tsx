// One editable block per step: step_header input, step_description textarea
// (600 maxlength + live character count), the step image (thumbnail when set)
// with an upload-only file control (specs/14 - add or replace a step image
// after ingestion; no URL input, no removal), and a remove button (disabled
// at the 1-step floor). "Add step" is disabled at the 6-step cap (specs/02
// rule 9) with an explanatory hint. All updates are immutable - every
// callback builds a fresh array/object.
import { useState, type ChangeEvent } from 'react';
import type { Step } from 'shared';
import { uploadStepImage } from '../../api/client.ts';
import { ACCEPTED_IMAGE_TYPES, validateImageFile } from '../../lib/upload-limits.ts';

const MAX_STEPS = 6;
const MIN_STEPS = 1;
const DESCRIPTION_MAXLENGTH = 600;
const ACCEPT = ACCEPTED_IMAGE_TYPES.join(',');

export function StepEditor({
  steps,
  onChange,
  readOnly = false,
  imageNamespaceId,
}: {
  steps: Step[]
  onChange: (steps: Step[]) => void
  readOnly?: boolean
  // Storage namespace for step-image uploads; the upload control is only
  // rendered when this is provided.
  imageNamespaceId?: string
}) {
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<number, string>>({});

  const updateField = (index: number, field: 'step_header' | 'step_description', value: string) => {
    onChange(steps.map((step, i) => (i === index ? { ...step, [field]: value } : step)));
  };

  const removeStep = (index: number) => {
    onChange(steps.filter((_, i) => i !== index));
  };

  const addStep = () => {
    onChange([...steps, { step_header: '', step_description: '' }]);
  };

  const handleImageSelect = async (index: number, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset the input so re-selecting the same file fires change again.
    event.target.value = '';
    if (!file || !imageNamespaceId) return;

    const validationErrors: string[] = [];
    validateImageFile(file, validationErrors);
    if (validationErrors.length > 0) {
      setUploadErrors((prev) => ({ ...prev, [index]: validationErrors[0] }));
      return;
    }

    setUploadErrors((prev) => {
      const { [index]: _cleared, ...rest } = prev;
      return rest;
    });
    setUploadingIndex(index);
    const result = await uploadStepImage(imageNamespaceId, index, file);
    setUploadingIndex(null);

    if (result.ok) {
      onChange(steps.map((step, i) => (i === index ? { ...step, image: result.value.url } : step)));
    } else {
      setUploadErrors((prev) => ({ ...prev, [index]: result.error.message }));
    }
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
          {step.image ? (
            <img
              className="step-editor-image-thumb"
              data-testid="step-image-thumb"
              src={step.image}
              alt={`Step ${index + 1}`}
            />
          ) : null}
          {imageNamespaceId ? (
            <label className="step-editor-image-upload">
              <span>{step.image ? 'Replace step image' : 'Upload step image'}</span>
              <input
                type="file"
                accept={ACCEPT}
                disabled={uploadingIndex !== null}
                onChange={(event) => void handleImageSelect(index, event)}
              />
            </label>
          ) : null}
          {uploadingIndex === index ? <span className="step-editor-image-status">Uploading...</span> : null}
          {uploadErrors[index] ? (
            <p className="step-editor-image-error" role="alert">
              {uploadErrors[index]}
            </p>
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
