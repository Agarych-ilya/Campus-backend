import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable,
} from '@nestjs/common';
import { normalizedStudyGroup } from './lesson-group-normalizer';

/**
 * Never trust a group supplied by the app. The session group must originate
 * from the protected BARS student list, verified on login.
 */
@Injectable()
export class LessonGroupGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<any>();
    const session = req.session;
    const age = session?.listingVerifiedAt;
    if (typeof age !== 'number' || age > Date.now() ||
      Date.now() - age >= 24 * 60 * 60 * 1000 ||
      !/^[a-f0-9]{64}$/.test(session?.listingOwnerKey ?? '') ||
      typeof session?.listingGroup !== 'string' ||
      !session.listingGroup.trim()) {
      throw new ForbiddenException('Для заметок требуется подтверждённая группа БАРС');
    }
    if (req.method === 'DELETE') return true;
    const requested = req.method === 'GET'
      ? req.query?.group : req.body?.group;
    if (typeof requested !== 'string' ||
      normalizedStudyGroup(requested) !== normalizedStudyGroup(session.listingGroup)) {
      throw new ForbiddenException('Заметки доступны только своей учебной группе');
    }
    return true;
  }
}
