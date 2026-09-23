import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { RbacAuditContext } from './rbac.types';

const extractId = (result: unknown): string | undefined =>
  typeof result === 'object' &&
  result !== null &&
  typeof (result as { id?: unknown }).id === 'string'
    ? (result as { id: string }).id
    : undefined;

@Injectable()
export class RbacAuditService {
  private readonly logger = new Logger('RbacAudit');

  /**
   * Runs a mutation and records its outcome, so that both applied changes and
   * rejections (403/404/409) end up in the audit log.
   */
  async track<T>(
    context: RbacAuditContext,
    successStatus: HttpStatus,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await work();

      this.record(
        { ...context, entityId: context.entityId ?? extractId(result) },
        successStatus,
      );

      return result;
    } catch (error) {
      this.record(
        context,
        error instanceof HttpException
          ? error.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR,
      );

      throw error;
    }
  }

  record(
    { actorUserId, operation, entity, entityId }: RbacAuditContext,
    status: number,
  ): void {
    const message = `actorUserId=${actorUserId} operation=${operation} entity=${entity}${
      entityId ? ` entityId=${entityId}` : ''
    } status=${status}`;

    if (status >= HttpStatus.BAD_REQUEST) {
      this.logger.warn(message);

      return;
    }

    this.logger.log(message);
  }
}
