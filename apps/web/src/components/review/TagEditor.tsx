// Tag editor: applied tags render as removable chips, every TAG_VOCABULARY
// entry renders as a toggle chip (pressed when applied), and a free-text
// input adds custom tags. Capped at 5 tags; removal is always possible.
// Every add/remove builds a fresh array via onChange - never mutates `tags`.
import { useState, type KeyboardEvent } from 'react';
import { TAG_VOCABULARY } from 'shared';

const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 40;

export function TagEditor({
  tags,
  onChange,
  readOnly = false,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  readOnly?: boolean
}) {
  const [customTag, setCustomTag] = useState('');
  const [error, setError] = useState<string | null>(null);

  const atCap = tags.length >= MAX_TAGS;

  const isApplied = (tag: string) => tags.some((t) => t.toLowerCase() === tag.toLowerCase());

  const addTag = (rawTag: string) => {
    const trimmed = rawTag.trim();
    if (trimmed.length < 1 || trimmed.length > MAX_TAG_LENGTH) {
      setError('Tag must be 1-40 characters.');
      return;
    }
    if (atCap) {
      setError('5 tag maximum.');
      return;
    }
    if (isApplied(trimmed)) {
      setError('That tag is already added.');
      return;
    }
    setError(null);
    onChange([...tags, trimmed]);
  };

  const removeTag = (tag: string) => {
    setError(null);
    onChange(tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()));
  };

  const toggleVocabTag = (tag: string) => {
    if (isApplied(tag)) {
      removeTag(tag);
    } else {
      addTag(tag);
    }
  };

  const handleAddCustom = () => {
    addTag(customTag);
    setCustomTag('');
  };

  const handleCustomKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleAddCustom();
    }
  };

  if (readOnly) {
    return (
      <div className="tag-editor">
        {tags.length > 0 ? (
          <ul className="tag-editor-applied" aria-label="Applied tags">
            {tags.map((tag) => (
              <li key={tag} className="tag-editor-chip">
                <span>{tag}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tag-editor-hint">No tags.</p>
        )}
      </div>
    );
  }

  return (
    <div className="tag-editor">
      {tags.length > 0 ? (
        <ul className="tag-editor-applied" aria-label="Applied tags">
          {tags.map((tag) => (
            <li key={tag} className="tag-editor-chip">
              <span>{tag}</span>
              <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove tag ${tag}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="tag-editor-vocab" role="group" aria-label="Tag vocabulary">
        {TAG_VOCABULARY.map((tag) => {
          const applied = isApplied(tag);
          return (
            <button
              key={tag}
              type="button"
              className="tag-editor-vocab-chip"
              aria-pressed={applied}
              disabled={!applied && atCap}
              onClick={() => toggleVocabTag(tag)}
            >
              {tag}
            </button>
          );
        })}
      </div>

      <div className="tag-editor-custom">
        <label>
          <span>Custom tag</span>
          <input
            type="text"
            value={customTag}
            disabled={atCap}
            onChange={(event) => setCustomTag(event.target.value)}
            onKeyDown={handleCustomKeyDown}
          />
        </label>
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddCustom} disabled={atCap}>
          Add
        </button>
      </div>

      {atCap ? <p className="tag-editor-hint">5 tag maximum</p> : null}
      {error ? <p className="tag-editor-hint tag-editor-error">{error}</p> : null}
    </div>
  );
}
