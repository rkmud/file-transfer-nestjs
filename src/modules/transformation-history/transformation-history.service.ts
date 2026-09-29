import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from '@/modules/users/users.service';
import { TransformationHistoryQueryDto } from './dto/transformation-history.dto';
import { TransformationLog } from './entities/transformation-log.entity';
import {
  decodeTransformationHistoryCursor,
  encodeTransformationHistoryCursor,
} from './transformation-history-cursor';
import { TRANSFORMATION_UNKNOWN_FORMAT } from './transformation-history.constants';
import {
  TransformationHistoryFilter,
  TransformationHistoryItem,
  TransformationHistoryPage,
  TransformationLogInput,
} from './transformation-history.types';

const CURSOR_CREATED_AT_ALIAS = 'cursor_created_at';

export type TransformationHistoryScope =
  { kind: 'self' } | { kind: 'admin'; userId?: string };

@Injectable()
export class TransformationHistoryService {
  private readonly logger = new Logger(TransformationHistoryService.name);

  constructor(
    @InjectRepository(TransformationLog)
    private logRepository: Repository<TransformationLog>,
    private usersService: UsersService,
  ) {}

  async record(input: TransformationLogInput): Promise<void> {
    try {
      await this.logRepository.upsert(
        this.logRepository.create({
          ...input,
          sourceFormat: input.sourceFormat ?? TRANSFORMATION_UNKNOWN_FORMAT,
        }),
        ['id'],
      );
    } catch {
      this.logger.error(
        `Failed to record transformation log: transformationId=${input.id}`,
      );
    }
  }

  async listOwn(
    actorUserId: string,
    query: TransformationHistoryQueryDto,
  ): Promise<TransformationHistoryPage> {
    return this.list(actorUserId, { kind: 'self' }, query);
  }

  async listForAdmin(
    actorUserId: string,
    query: TransformationHistoryQueryDto,
    userId?: string,
  ): Promise<TransformationHistoryPage> {
    if (userId && !(await this.usersService.getUserById(userId))) {
      throw new NotFoundException('User not found');
    }

    return this.list(actorUserId, { kind: 'admin', userId }, query);
  }

  private async list(
    actorUserId: string,
    scope: TransformationHistoryScope,
    query: TransformationHistoryQueryDto,
  ): Promise<TransformationHistoryPage> {
    const filter = this.toFilter(
      query,
      scope.kind === 'self' ? actorUserId : scope.userId,
    );
    const after = query.cursor
      ? decodeTransformationHistoryCursor(query.cursor)
      : undefined;
    const { limit } = query;

    const qb = this.logRepository
      .createQueryBuilder('log')
      .addSelect(
        `to_char("log"."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        CURSOR_CREATED_AT_ALIAS,
      )
      .orderBy('log.createdAt', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .limit(limit + 1);

    if (filter.userId) {
      qb.andWhere('"log"."user_id" = :userId', { userId: filter.userId });
    }

    if (filter.type) {
      qb.andWhere('"log"."type" = :type', { type: filter.type });
    }

    if (filter.status) {
      qb.andWhere('"log"."status" = :status', { status: filter.status });
    }

    if (filter.sourceFormat) {
      qb.andWhere('"log"."source_format" = :sourceFormat', {
        sourceFormat: filter.sourceFormat,
      });
    }

    if (filter.targetFormat) {
      qb.andWhere('"log"."target_format" = :targetFormat', {
        targetFormat: filter.targetFormat,
      });
    }

    if (filter.createdAtFrom) {
      qb.andWhere('"log"."created_at" >= :createdAtFrom', {
        createdAtFrom: filter.createdAtFrom,
      });
    }

    if (filter.createdAtTo) {
      qb.andWhere('"log"."created_at" <= :createdAtTo', {
        createdAtTo: filter.createdAtTo,
      });
    }

    if (after) {
      qb.andWhere(
        '("log"."created_at", "log"."id") < (CAST(:cursorCreatedAt AS timestamptz), CAST(:cursorId AS uuid))',
        { cursorCreatedAt: after.createdAt, cursorId: after.id },
      );
    }

    const { entities, raw } =
      await qb.getRawAndEntities<Record<string, string>>();
    const hasMore = entities.length > limit;
    const items = hasMore ? entities.slice(0, limit) : entities;
    const last = items.at(-1);
    const lastCreatedAt = last
      ? raw.find((row) => row.log_id === last.id)?.[CURSOR_CREATED_AT_ALIAS]
      : undefined;

    this.logger.log(
      `Transformation history listed: actorUserId=${actorUserId} scope=${scope.kind}${
        filter.userId && scope.kind === 'admin'
          ? ` userId=${filter.userId}`
          : ''
      } count=${items.length}${after ? ' cursor=true' : ''}`,
    );

    return {
      items: items.map((log) => this.toItem(log)),
      pageInfo: {
        limit,
        hasMore,
        nextCursor:
          hasMore && last && lastCreatedAt
            ? encodeTransformationHistoryCursor({
                createdAt: lastCreatedAt,
                id: last.id,
              })
            : null,
      },
    };
  }

  private toFilter(
    query: TransformationHistoryQueryDto,
    userId: string | undefined,
  ): TransformationHistoryFilter {
    const createdAtFrom = query.createdAtFrom
      ? new Date(query.createdAtFrom)
      : undefined;
    const createdAtTo = query.createdAtTo
      ? new Date(query.createdAtTo)
      : undefined;

    if (createdAtFrom && createdAtTo && createdAtFrom > createdAtTo) {
      throw new BadRequestException(
        'createdAtFrom must not be later than createdAtTo',
      );
    }

    return {
      userId,
      type: query.type,
      sourceFormat: query.sourceFormat,
      targetFormat: query.targetFormat,
      status: query.status,
      createdAtFrom,
      createdAtTo,
    };
  }

  private toItem(log: TransformationLog): TransformationHistoryItem {
    return {
      id: log.id,
      userId: log.userId,
      type: log.type,
      sourceFormat: log.sourceFormat,
      targetFormat: log.targetFormat,
      status: log.status,
      fileSize: log.fileSize,
      durationMs: log.durationMs,
      errorCode: log.errorCode,
      isStored: log.isStored,
      expiresAt: log.expiresAt,
      createdAt: log.createdAt,
    };
  }
}
