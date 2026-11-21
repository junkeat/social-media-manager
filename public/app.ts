type Platform = 'facebook' | 'instagram' | 'threads';

interface PlatformResult {
  platform: Platform;
  success: boolean;
  postId?: string;
  error?: string;
}

// Shape of what /api/publish sends back (our own server, so we trust it).
interface PublishResponse {
  results?: PlatformResult[];
  errors?: string[];
  error?: string;
}

const PLATFORMS: Record<Platform, { label: string; limit: number }> = {
  facebook: { label: 'Facebook', limit: 63206 },
  instagram: { label: 'Instagram', limit: 2200 },
  threads: { label: 'Threads', limit: 500 },
};

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const form = byId<HTMLFormElement>('publish-form');
const errorBox = byId<HTMLDivElement>('form-error');
const textInput = byId<HTMLTextAreaElement>('post-text');
const imageInput = byId<HTMLInputElement>('post-image');
const counters = byId<HTMLDivElement>('char-counters');
const publishButton = byId<HTMLButtonElement>('publish-btn');
const resultsSection = byId<HTMLElement>('results-section');
const resultsStatus = byId<HTMLParagraphElement>('results-status');
const resultsList = byId<HTMLUListElement>('results-list');

const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="platforms"]')];

function selectedPlatforms(): Platform[] {
  return checkboxes.filter((box) => box.checked).map((box) => box.value as Platform);
}

function element(tag: string, text: string, className = ''): HTMLElement {
  const el = document.createElement(tag);
  el.textContent = text;
  el.className = className;
  return el;
}

// ---- Character counters ----

function renderCounters(): void {
  const length = textInput.value.length;
  const platforms = selectedPlatforms();

  if (platforms.length === 0) {
    counters.replaceChildren(element('span', 'Select at least one platform.', 'counter-empty'));
    return;
  }

  counters.replaceChildren(
    ...platforms.map((platform) => {
      const { label, limit } = PLATFORMS[platform];
      const over = length > limit;
      const text = `${label}: ${length.toLocaleString()} / ${limit.toLocaleString()}${over ? ' — Over limit' : ''}`;
      return element('span', text, over ? 'counter-item counter-over' : 'counter-item');
    })
  );
}

// ---- Validation (the server checks again; this just saves a round trip) ----

interface Problems {
  messages: string[];
  badText: boolean;
  badImage: boolean;
}

function findProblems(): Problems {
  const platforms = selectedPlatforms();
  const text = textInput.value;
  const image = imageInput.files?.[0];
  const problems: Problems = { messages: [], badText: false, badImage: false };

  if (platforms.length === 0) problems.messages.push('Select at least one platform.');

  if (!image && !text.trim()) {
    problems.messages.push('Enter post text or attach an image.');
    problems.badText = true;
  }

  if (platforms.includes('instagram')) {
    const isJpeg = image && image.type === 'image/jpeg' && /\.jpe?g$/i.test(image.name);
    if (!image) {
      problems.messages.push('Instagram requires an image. Attach a JPEG image or uncheck Instagram.');
      problems.badImage = true;
    } else if (!isJpeg) {
      problems.messages.push('Instagram only accepts JPEG images (.jpg or .jpeg).');
      problems.badImage = true;
    }
  }

  for (const platform of platforms) {
    const { label, limit } = PLATFORMS[platform];
    if (text.length > limit) {
      problems.messages.push(`Text exceeds the ${label} limit of ${limit} characters (currently ${text.length}).`);
      problems.badText = true;
    }
  }

  return problems;
}

function clearErrors(): void {
  errorBox.hidden = true;
  errorBox.replaceChildren();
  textInput.setAttribute('aria-invalid', 'false');
  imageInput.setAttribute('aria-invalid', 'false');
}

function showErrors(messages: string[], badText = false, badImage = false): void {
  textInput.setAttribute('aria-invalid', String(badText));
  imageInput.setAttribute('aria-invalid', String(badImage));

  const list = document.createElement('ul');
  list.append(...messages.map((message) => element('li', message)));
  errorBox.replaceChildren(list);
  errorBox.hidden = false;
  errorBox.focus(); // Screen readers announce the error summary when it gets focus.
}

// ---- Results ----

function renderResults(results: PlatformResult[]): void {
  const succeeded = results.filter((result) => result.success).length;

  resultsList.replaceChildren(
    ...results.map((result) => {
      const card = document.createElement('li');
      card.className = `result-card ${result.success ? 'result-success' : 'result-failure'}`;

      const header = element('div', '', 'result-header');
      header.append(
        element('span', PLATFORMS[result.platform].label),
        element('span', result.success ? 'Success' : 'Failed', 'result-badge')
      );

      const detail = result.success
        ? `Post ID: ${result.postId ?? 'Unknown'}`
        : result.error ?? 'Publishing failed.';
      card.append(header, element('p', detail, 'result-detail'));
      return card;
    })
  );

  resultsSection.hidden = false;
  resultsStatus.textContent = `Publish complete: ${succeeded} succeeded, ${results.length - succeeded} failed.`;
}

// ---- Submit ----

async function publish(): Promise<void> {
  const response = await fetch('/api/publish', { method: 'POST', body: new FormData(form) });
  const body = (await response.json().catch(() => ({}))) as PublishResponse;

  if (response.ok && body.results) {
    renderResults(body.results);
    return;
  }

  const messages = body.errors ?? [body.error ?? `Request failed (HTTP ${response.status}).`];
  showErrors(messages);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const problems = findProblems();
  if (problems.messages.length > 0) {
    showErrors(problems.messages, problems.badText, problems.badImage);
    return;
  }

  clearErrors();
  publishButton.disabled = true; // Stops double-posting while the request runs.
  publishButton.textContent = 'Publishing...';

  try {
    await publish();
  } catch {
    showErrors(['Could not reach the server. Check that the app is running and try again.']);
  } finally {
    publishButton.disabled = false;
    publishButton.textContent = 'Publish';
  }
});

// Once errors are showing, clear them as soon as the form becomes valid.
function clearErrorsWhenFixed(): void {
  if (!errorBox.hidden && findProblems().messages.length === 0) clearErrors();
}

textInput.addEventListener('input', () => {
  renderCounters();
  clearErrorsWhenFixed();
});
imageInput.addEventListener('change', clearErrorsWhenFixed);
checkboxes.forEach((box) =>
  box.addEventListener('change', () => {
    renderCounters();
    clearErrorsWhenFixed();
  })
);

renderCounters();
