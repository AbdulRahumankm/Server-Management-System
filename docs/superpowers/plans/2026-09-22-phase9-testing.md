# Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two remaining gaps against the original request's §23 explicit minimum test list, then run the full backend and frontend suites once as a whole-repo verification. This is Phase 9.

**Architecture:** No new architecture — this phase is entirely about test coverage. Every prior phase followed TDD (test-first, real Postgres for backend integration tests), so most of §23's list is already satisfied:

| Original request's §23 item | Already covered by | Gap? |
|---|---|---|
| Authentication | `backend/tests/auth.test.ts` | none |
| RBAC | `backend/tests/requirePermission.test.ts` + 403 assertions in every other integration test | none |
| Server CRUD | `backend/tests/servers.test.ts` | none |
| Inventory CRUD | `backend/tests/inventory.test.ts` | none |
| Key upload | `backend/tests/keys.test.ts` | none |
| Key authorization | `backend/tests/keys.test.ts` (viewer 403) | none |
| Key download authorization | `backend/tests/keys.test.ts` (viewer 403, admin 200) | none |
| Audit logging | `backend/tests/audit.test.ts` | none |
| Login (frontend) | `frontend/tests/login.test.tsx` | none |
| Server form validation (frontend) | `frontend/tests/server-form.test.tsx` | none |
| **Inventory creation (frontend)** | `dynamic-record-form.test.tsx` covers the record form; nothing exercises `EntityFieldBuilder` (the entity-creation field builder) | **yes** |
| **Key management UI (frontend)** | `keys-list.test.tsx` covers the list/permission-gating; nothing exercises the upload page's actual submit flow | **yes** |

**Tech Stack:** No new dependencies.

**Spec:** Original request §23 (Testing).

## Global Constraints

- No fabricated or assumed-passing results — every test added here is run and its actual output reported before being called done, per this project's standing rule (`superpowers:verification-before-completion`).

---

## File Structure

```
frontend/tests/
├── entity-field-builder.test.tsx
└── keys-upload.test.tsx
```

---

### Task 1: `EntityFieldBuilder` interaction test (closes "Inventory creation" gap)

**Files:**
- Test: `frontend/tests/entity-field-builder.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EntityFieldBuilder, FieldDraft } from '../components/inventory/EntityFieldBuilder';

describe('EntityFieldBuilder', () => {
  const baseField: FieldDraft = { fieldName: '', fieldType: 'TEXT', required: false, options: '' };

  it('calls onChange with an added field when "Add Field" is clicked', () => {
    const onChange = vi.fn();
    render(<EntityFieldBuilder fields={[baseField]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Field' }));

    expect(onChange).toHaveBeenCalledWith([
      baseField,
      { fieldName: '', fieldType: 'TEXT', required: false, options: '' },
    ]);
  });

  it('shows an options input only when the field type is SELECT', () => {
    const onChange = vi.fn();
    const { rerender } = render(<EntityFieldBuilder fields={[baseField]} onChange={onChange} />);
    expect(screen.queryByLabelText(/options/i)).toBeNull();

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'SELECT' } });
    const updatedFields = onChange.mock.calls[0][0];
    rerender(<EntityFieldBuilder fields={updatedFields} onChange={onChange} />);

    expect(screen.getByLabelText(/options/i)).toBeDefined();
  });

  it('removes a field when its Remove button is clicked', () => {
    const onChange = vi.fn();
    const secondField: FieldDraft = { ...baseField, fieldName: 'second' };
    render(<EntityFieldBuilder fields={[baseField, secondField]} onChange={onChange} />);

    fireEvent.click(screen.getAllByText('Remove')[0]);

    expect(onChange).toHaveBeenCalledWith([secondField]);
  });
});
```

- [ ] **Step 2: Run it**

Run (from `frontend/`): `npx vitest run tests/entity-field-builder.test.tsx`
Expected: PASS — 3 passed (this exercises existing, already-implemented behavior — no new component code is needed, so there's no red phase here, unlike feature-adding tasks in earlier phases)

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/entity-field-builder.test.tsx
git commit -m "test(frontend): cover EntityFieldBuilder add/remove/type-change interactions"
```

---

### Task 2: Key upload page interaction test (closes "Key management UI" gap)

**Files:**
- Test: `frontend/tests/keys-upload.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UploadKeyPage from '../app/keys/upload/page';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe('UploadKeyPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('submits the form as multipart FormData and redirects to /keys on success', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    render(<UploadKeyPage />);

    fireEvent.change(screen.getByLabelText('Key Name'), { target: { value: 'ci-key' } });
    const file = new File(['-----BEGIN OPENSSH PRIVATE KEY-----'], 'id_ed25519', {
      type: 'text/plain',
    });
    fireEvent.change(screen.getByLabelText('Private Key File'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload Key' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/keys'));

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('does not redirect when the upload is rejected', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'File does not look like a PEM-encoded private key' }),
    });

    render(<UploadKeyPage />);
    fireEvent.change(screen.getByLabelText('Key Name'), { target: { value: 'bad-key' } });
    const file = new File(['not a key'], 'bad.txt');
    fireEvent.change(screen.getByLabelText('Private Key File'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload Key' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(pushMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it**

Run (from `frontend/`): `npx vitest run tests/keys-upload.test.tsx`
Expected: PASS — 2 passed

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/keys-upload.test.tsx
git commit -m "test(frontend): cover key upload page's multipart submit and failure path"
```

---

### Task 3: Whole-repo verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite against a real Postgres**

```bash
docker run -d --name temp-postgres-phase9 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=server_inventory -p 5432:5432 postgres:16-alpine
# wait for pg_isready, then from backend/:
npx prisma migrate deploy
npm test
npm run lint
npx tsc --noEmit
docker stop temp-postgres-phase9 && docker rm temp-postgres-phase9
```

Expected: every backend suite passes (13 suites / 54+ tests as of Phase 8; this phase adds no backend tests), lint and typecheck both exit 0.

- [ ] **Step 2: Run the full frontend suite**

```bash
npm test && npm run lint && npx tsc --noEmit && npm run build
```

Expected: all frontend suites pass (9 files after this phase's 2 new ones), lint/typecheck/build all exit 0.

- [ ] **Step 3: Report actual results**

State the real pass/fail counts from Steps 1-2 — don't claim success without having run them, per `superpowers:verification-before-completion`.

---

## Self-Review Notes

- **Spec coverage:** Every item in §23's minimum test list now has a real, executed test, per the gap table in this plan's Architecture section.
- **No placeholders:** every step has literal test code or literal commands with expected output.
