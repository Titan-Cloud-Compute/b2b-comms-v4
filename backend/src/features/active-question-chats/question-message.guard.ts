import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, mergeMap, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { QUESTION_KIND, STATUS_RESOLVED } from './active-question-chats.service';

/**
 * Matches General Channels' message-post routes, e.g.
 *   POST /api/channels/:id/messages
 * (questions are channels with kind "question", so posts can arrive there too).
 */
const CHANNEL_MESSAGE_ROUTE = /^\/api\/channels\/([^/?#]+)\/messages\/?(?:[?#].*)?$/;

export function channelIdFromMessagePost(method: string | undefined, url: string | undefined): string | null {
  if ((method ?? '').toUpperCase() !== 'POST' || !url) return null;
  const m = CHANNEL_MESSAGE_ROUTE.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Global interceptor (registered as APP_INTERCEPTOR) that applies the Active
 * Question rules to General Channels' message routes without editing that
 * feature: a post into a resolved question is 403; a successful post into an
 * open question clears any pending resolution marks.
 */
@Injectable()
export class QuestionMessageGuard implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<{ method?: string; originalUrl?: string; url?: string }>();
    const channelId = channelIdFromMessagePost(req.method, req.originalUrl ?? req.url);
    if (!channelId) return next.handle();

    return from(this.prisma.channels.findUnique({ where: { id: channelId } })).pipe(
      mergeMap((ch) => {
        if (!ch || ch.kind !== QUESTION_KIND) return next.handle();
        if (ch.status === STATUS_RESOLVED) {
          throw new ForbiddenException('This question is resolved; no further messages can be posted.');
        }
        return next.handle().pipe(
          tap({
            next: () => {
              void this.prisma.question_resolutions
                .deleteMany({ where: { channel_id: channelId } })
                .catch(() => undefined);
            },
          }),
        );
      }),
    );
  }
}
