import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  AuthenticatedUser,
  RequestUser,
  toRequestUser,
} from '../interfaces/authenticated-user.interface';

/**
 * Extended Fastify request with user property.
 *
 * `user` is what Passport attaches: the full `AuthenticatedUser` row with its
 * `userRoles` graph. `requestUser` is the flattened `{ roles, permissions }`
 * view, and only the permissions/roles guards set it.
 */
interface FastifyRequestWithUser {
  user?: AuthenticatedUser | RequestUser;
  requestUser?: RequestUser;
}

/** Is this the raw Passport row rather than the flattened view? */
function isAuthenticatedUser(
  user: AuthenticatedUser | RequestUser,
): user is AuthenticatedUser {
  return Array.isArray((user as AuthenticatedUser).userRoles);
}

/**
 * Decorator to extract the current authenticated user from the request
 *
 * The decorator can extract properties from either `request.requestUser` (simplified user
 * set by guards) or `request.user` (full authenticated user from JWT strategy).
 *
 * @example
 * ```typescript
 * // Get full user object
 * @Get('profile')
 * getProfile(@CurrentUser() user: RequestUser) {
 *   return user;
 * }
 *
 * // Get specific property
 * @Get('email')
 * getEmail(@CurrentUser('email') email: string) {
 *   return { email };
 * }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (data: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<FastifyRequestWithUser>();

    // On a route gated only by `@Auth()`, no permissions or roles guard has
    // run, so `requestUser` is unset and `request.user` is the raw Passport
    // row — which has a `userRoles` graph and NO `permissions` array. Every
    // call site already annotates this parameter as `RequestUser`, so the
    // difference was invisible at the type level and silent at runtime:
    // `user.permissions.includes(...)` was `undefined` on exactly the routes
    // that are not permission-gated. Issue #71 needs it on `@Auth()`-only
    // storage routes, so the decorator flattens here and caches the result on
    // the request rather than every controller learning the distinction.
    if (!request.requestUser && request.user && isAuthenticatedUser(request.user)) {
      request.requestUser = toRequestUser(request.user);
    }

    const user: RequestUser | undefined =
      request.requestUser ??
      (request.user && !isAuthenticatedUser(request.user)
        ? request.user
        : undefined);

    return data ? user?.[data] : user;
  },
);
