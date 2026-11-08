import { ForbiddenException } from '@nestjs/common';
import { LessonGroupGuard } from './lesson-group.guard';
import { normalizedStudyGroup } from './lesson-group-normalizer';

describe('LessonGroupGuard', () => {
  const guard = new LessonGroupGuard();
  function context(method: string, group?: string, verified = 'А-03-23') {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          query: {group},
          body: {group},
          session: {
            listingOwnerKey: 'a'.repeat(64),
            listingVerifiedAt: Date.now(),
            listingGroup: verified,
          },
        }),
      }),
    } as any;
  }

  it('permits only the same verified group for reads', () => {
    expect(guard.canActivate(context('GET', 'А-03-23'))).toBe(true);
    expect(guard.canActivate(context('GET', 'A-03-23'))).toBe(true);
    expect(() => guard.canActivate(context('GET', 'А-20-24')))
      .toThrow(ForbiddenException);
  });

  it('refuses publishing for another group', () => {
    expect(guard.canActivate(context('POST', 'А-03-23'))).toBe(true);
    expect(() => guard.canActivate(context('POST', 'А-20-24')))
      .toThrow(ForbiddenException);
  });

  it('requires BARS verified membership even for deletion', () => {
    expect(() => guard.canActivate(context('DELETE', undefined, '')))
      .toThrow(ForbiddenException);
  });

  it('normalizes Latin A but does not equate different groups', () => {
    expect(normalizedStudyGroup('a-03-23')).toBe('А-03-23');
    expect(normalizedStudyGroup('А-03-23'))
      .not.toBe(normalizedStudyGroup('А-04-23'));
  });
});
