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
/**
 * `data` is optional and almost always absent — the point of an action is the
 * side effect, and the page re-renders from the server afterwards. It exists
 * for the handful that must hand something back that is never persisted in
 * readable form: the two-factor enrolment secret and the recovery codes, which
 * are shown exactly once and stored only as hashes.
 */
export type ActionResult<T = unknown> = { ok: boolean; message: string; data?: T };

export const ok = <T,>(message: string, data?: T): ActionResult<T> => ({ ok: true, message, data });
/** A failure carries no data, so it satisfies any ActionResult<T>. */
export const fail = <T = unknown,>(message: string): ActionResult<T> => ({ ok: false, message });

/**
 * Wraps an action body, converting an API failure into a readable result.
 *
 * 403 is translated deliberately: the API's role message is accurate but
 * phrased for a developer, and an operator needs to know it is a permission
 * problem rather than a bug in the page.
 */
export async function run<T = unknown>(
  successMessage: string,
  body: () => Promise<T>
): Promise<ActionResult<T>> {
  try {
    const data = await body();
    return ok(successMessage, data);
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
