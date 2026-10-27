/**
 * The optional project a work-order request belongs to, supplied by the host or link (`?project=<id>`).
 * The NEAR account id stays the one key that joins a contributor across apps; the project only says which
 * project or budget a request is for. It is never trusted for access: records are returned only to the
 * signed-in account that owns them, with or without it.
 */
const PROJECT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** The project id in a query string, or null if it is absent, repeated or not a plain identifier. */
export function projectRef(search: string): string | null {
  const values = new URLSearchParams(search).getAll("project");
  return values.length === 1 && PROJECT.test(values[0]!) ? values[0]! : null;
}

/**
 * Whether the platform contract records a project on a work-order request. The request schema is strict, so a
 * field it does not declare would be refused: the project is sent, and shown as saved, only when it is declared.
 */
export const recordsProject = (requestShape: object) => "project" in requestShape;
