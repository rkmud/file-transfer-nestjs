import { TransformationLog } from '@/modules/transformation-history/entities/transformation-log.entity';
import { QueryContext } from './in-memory-repository';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const toCursorTimestamp = (date: Date): string =>
  date.toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');

const time = (value: Date | string): number =>
  value instanceof Date ? value.getTime() : Date.parse(value);

const byCreatedAtThenIdDesc = (
  a: TransformationLog,
  b: TransformationLog,
): number =>
  b.createdAt.getTime() - a.createdAt.getTime() ||
  (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

const resolveList = (ctx: QueryContext<TransformationLog>) => {
  const p = ctx.params;
  const cursorAt =
    p.cursorCreatedAt !== undefined ? time(p.cursorCreatedAt) : undefined;
  const entities = ctx.rows
    .filter((row) => p.userId === undefined || row.userId === p.userId)
    .filter((row) => p.type === undefined || row.type === p.type)
    .filter((row) => p.status === undefined || row.status === p.status)
    .filter(
      (row) =>
        p.sourceFormat === undefined || row.sourceFormat === p.sourceFormat,
    )
    .filter(
      (row) =>
        p.targetFormat === undefined || row.targetFormat === p.targetFormat,
    )
    .filter(
      (row) =>
        p.createdAtFrom === undefined ||
        row.createdAt.getTime() >= time(p.createdAtFrom),
    )
    .filter(
      (row) =>
        p.createdAtTo === undefined ||
        row.createdAt.getTime() <= time(p.createdAtTo),
    )
    .filter((row) => {
      if (cursorAt === undefined) return true;

      const at = row.createdAt.getTime();

      return at < cursorAt || (at === cursorAt && row.id < p.cursorId);
    })
    .sort(byCreatedAtThenIdDesc)
    .slice(0, ctx.limit ?? Infinity);

  return {
    entities,
    raw: entities.map((row) => ({
      [`${ctx.alias}_id`]: row.id,
      cursor_created_at: toCursorTimestamp(row.createdAt),
    })),
  };
};

const resolvePurge = (ctx: QueryContext<TransformationLog>) => {
  const now = Date.now();

  return ctx.rows
    .filter(
      (row) => row.isStored && row.expiresAt && row.expiresAt.getTime() <= now,
    )
    .filter(
      (row) => ctx.params.lastId === undefined || row.id > ctx.params.lastId,
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, ctx.limit ?? Infinity)
    .map((row) => {
      const partial = new TransformationLog();

      partial.id = row.id;
      partial.storagePath = row.storagePath;

      return partial;
    });
};

export const transformationHistoryQueryResolver = (
  ctx: QueryContext<TransformationLog>,
): any => {
  if (ctx.terminal === 'getRawAndEntities') return resolveList(ctx);
  if (ctx.terminal === 'getMany') return resolvePurge(ctx);

  throw new Error(
    `transformationHistoryQueryResolver: unsupported terminal ${ctx.terminal}`,
  );
};
