import { ApiError } from './api';

/**
 * The uniform return shape of every Server Action in this console.
 *
 * Actions return a result instead of throwing so the client always has a
 * message to show. An action that throws in production gets replaced by Next
 * with a generic "An error occurred in the Server Components render", which
 * strips exactly the detail the operator needs — "your role cannot do this" or
 * "that driver is already suspended".
 */
export type ActionResult = { ok: boolean; message: string };

export const ok = (message: string): ActionResult => ({ ok: true, message });
export const fail = (message: string): ActionResult => ({ ok: false, message });

/**
 * Wraps an action body, converting an API failure into a readable result.
 *
 * 403 is translated deliberately: the API's role message is accurate but
 * phrased for a developer, and an operator needs to know it is a permission
 * problem rather than a bug in the page.
 */
export async function run(
  successMessage: string,
  body: () => Promise<unknown>
): Promise<ActionResult> {
  try {
    await body();
    return ok(successMessage);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.forbidden) {
        return fail(err.message || 'Your role does not permit this action.');
      }
      if (err.unauthorized) {
        return fail('Your session expired. Reload the page and sign in again.');
      }
      return fail(err.message);
    }
    return fail((err as Error)?.message || 'Something went wrong.');
  }
}
