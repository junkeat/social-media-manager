type Platform = 'facebook' | 'instagram' | 'threads';

interface PlatformResult {
  platform: Platform;
  success: boolean;
  postId?: string;
  error?: string;
}

interface PublishApiResponse {
  results?: PlatformResult[];
  error?: string;
  errors?: string[];
}

const PLATFORM_LIMITS: Record<Platform, number> = {
  facebook: 63206,
  instagram: 2200,
  threads: 500,
};

const PLATFORM_LABELS: Record<Platform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  threads: 'Threads',
};

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as T;
}

function isPlatform(value: string): value is Platform {
  return value === 'facebook' || value === 'instagram' || value === 'threads';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlatformResult(value: unknown): value is PlatformResult {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.platform !== 'string' || !isPlatform(value.platform)) {
    return false;
  }

  return typeof value.success === 'boolean';
}

function parseApiResponse(payload: unknown): PublishApiResponse {
  if (!isRecord(payload)) {
    return {};
  }

  const results = Array.isArray(payload.results)
    ? payload.results.filter(isPlatformResult)
    : undefined;
  const errors = Array.isArray(payload.errors)
    ? payload.errors.filter((item): item is string => typeof item === 'string')
    : undefined;
  const error = typeof payload.error === 'string' ? payload.error : undefined;

  return { results, errors, error };
}

function isJpegFile(file: File): boolean {
  const mime = file.type.toLowerCase();
  const hasJpegExtension = /\.(jpe?g)$/i.test(file.name);
  return mime === 'image/jpeg' && hasJpegExtension;
}

const formEl = requireElement<HTMLFormElement>('publish-form');
const formErrorEl = requireElement<HTMLDivElement>('form-error');
const textEl = requireElement<HTMLTextAreaElement>('post-text');
const countersEl = requireElement<HTMLDivElement>('char-counters');
const imageEl = requireElement<HTMLInputElement>('post-image');
const publishBtnEl = requireElement<HTMLButtonElement>('publish-btn');
const resultsSectionEl = requireElement<HTMLElement>('results-section');
const resultsStatusEl = requireElement<HTMLParagraphElement>('results-status');
const resultsListEl = requireElement<HTMLUListElement>('results-list');

const platformCheckboxes = Array.from(
  formEl.querySelectorAll<HTMLInputElement>('input[name="platforms"]')
);

function getSelectedPlatforms(): Platform[] {
  const selected: Platform[] = [];
  for (const checkbox of platformCheckboxes) {
    if (checkbox.checked && isPlatform(checkbox.value)) {
      selected.push(checkbox.value);
    }
  }
  return selected;
}

function renderCharCounters(): void {
  const selected = getSelectedPlatforms();
  const length = textEl.value.length;
  const nodes: HTMLElement[] = [];

  if (selected.length === 0) {
    const emptyNote = document.createElement('span');
    emptyNote.className = 'counter-empty';
    emptyNote.textContent = 'Select at least one platform.';
    countersEl.replaceChildren(emptyNote);
    return;
  }

  for (const platform of selected) {
    const limit = PLATFORM_LIMITS[platform];
    const isOver = length > limit;
    const item = document.createElement('span');
    item.className = isOver ? 'counter-item counter-over' : 'counter-item';
    item.textContent = `${PLATFORM_LABELS[platform]}: ${length.toLocaleString()} / ${limit.toLocaleString()}${
      isOver ? ' — Over limit' : ''
    }`;
    nodes.push(item);
  }

  countersEl.replaceChildren(...nodes);
}

interface ClientValidation {
  errors: string[];
  invalidFields: Set<'text' | 'image'>;
}

function validateForm(): ClientValidation {
  const selected = getSelectedPlatforms();
  const text = textEl.value;
  const imageFile = imageEl.files?.[0];
  const errors: string[] = [];
  const invalidFields = new Set<'text' | 'image'>();

  if (selected.length === 0) {
    errors.push('Select at least one platform.');
  }

  if (!imageFile && text.trim().length === 0) {
    errors.push('Enter post text or attach an image.');
    invalidFields.add('text');
  }

  if (selected.includes('instagram')) {
    if (!imageFile) {
      errors.push(
        'Instagram requires an image. Attach a JPEG image or uncheck Instagram.'
      );
      invalidFields.add('image');
    } else if (!isJpegFile(imageFile)) {
      errors.push('Instagram only accepts JPEG images (.jpg or .jpeg).');
      invalidFields.add('image');
    }
  }

  for (const platform of selected) {
    const limit = PLATFORM_LIMITS[platform];
    if (text.length > limit) {
      errors.push(
        `Text exceeds the ${PLATFORM_LABELS[platform]} limit of ${limit} characters (currently ${text.length}).`
      );
      invalidFields.add('text');
    }
  }

  return { errors, invalidFields };
}

function clearFormErrors(): void {
  formErrorEl.hidden = true;
  formErrorEl.replaceChildren();
  textEl.setAttribute('aria-invalid', 'false');
  imageEl.setAttribute('aria-invalid', 'false');
}

function showFormErrors(
  errors: readonly string[],
  invalidFields: Set<'text' | 'image'>
): void {
  textEl.setAttribute('aria-invalid', invalidFields.has('text') ? 'true' : 'false');
  imageEl.setAttribute('aria-invalid', invalidFields.has('image') ? 'true' : 'false');

  if (errors.length === 1) {
    const paragraph = document.createElement('p');
    paragraph.textContent = errors[0];
    formErrorEl.replaceChildren(paragraph);
  } else {
    const list = document.createElement('ul');
    for (const message of errors) {
      const li = document.createElement('li');
      li.textContent = message;
      list.append(li);
    }
    formErrorEl.replaceChildren(list);
  }

  formErrorEl.hidden = false;
  formErrorEl.focus();
}

function renderResults(results: readonly PlatformResult[]): void {
  const items: HTMLLIElement[] = [];
  let successCount = 0;

  for (const result of results) {
    if (result.success) {
      successCount += 1;
    }

    const li = document.createElement('li');
    li.className = result.success
      ? 'result-card result-success'
      : 'result-card result-failure';

    const header = document.createElement('div');
    header.className = 'result-header';

    const platformName = document.createElement('span');
    platformName.textContent = PLATFORM_LABELS[result.platform];

    const badge = document.createElement('span');
    badge.className = 'result-badge';
    badge.textContent = result.success ? 'Success' : 'Failed';

    header.append(platformName, badge);

    const detail = document.createElement('p');
    detail.className = 'result-detail';
    detail.textContent = result.success
      ? `Post ID: ${result.postId ?? 'Unknown'}`
      : result.error ?? 'Publishing failed.';

    li.append(header, detail);
    items.push(li);
  }

  const failureCount = results.length - successCount;
  resultsListEl.replaceChildren(...items);
  resultsSectionEl.hidden = false;
  resultsStatusEl.textContent = `Publish complete: ${successCount} succeeded, ${failureCount} failed.`;
}

function syncValidationOnEdit(): void {
  if (formErrorEl.hidden) {
    return;
  }

  const validation = validateForm();
  if (validation.errors.length === 0) {
    clearFormErrors();
  }
}

async function handleSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();

  const validation = validateForm();
  if (validation.errors.length > 0) {
    showFormErrors(validation.errors, validation.invalidFields);
    return;
  }

  clearFormErrors();
  publishBtnEl.disabled = true;
  publishBtnEl.textContent = 'Publishing...';

  try {
    const response = await fetch('/api/publish', {
      method: 'POST',
      body: new FormData(formEl),
    });

    const rawBody = (await response.json().catch(() => undefined)) as unknown;
    const body = parseApiResponse(rawBody);

    if (!response.ok) {
      const serverErrors =
        body.errors && body.errors.length > 0
          ? body.errors
          : [body.error ?? `Request failed (HTTP ${response.status}).`];
      showFormErrors(serverErrors, new Set());
      return;
    }

    if (body.results) {
      renderResults(body.results);
    }
  } catch {
    showFormErrors(
      ['Could not reach the server. Check that the app is running and try again.'],
      new Set()
    );
  } finally {
    publishBtnEl.disabled = false;
    publishBtnEl.textContent = 'Publish';
  }
}

textEl.addEventListener('input', () => {
  renderCharCounters();
  syncValidationOnEdit();
});

imageEl.addEventListener('change', () => {
  syncValidationOnEdit();
});

for (const checkbox of platformCheckboxes) {
  checkbox.addEventListener('change', () => {
    renderCharCounters();
    syncValidationOnEdit();
  });
}

formEl.addEventListener('submit', (event) => {
  void handleSubmit(event);
});

renderCharCounters();
