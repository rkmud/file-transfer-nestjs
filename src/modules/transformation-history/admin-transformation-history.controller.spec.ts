import { StreamableFile } from '@nestjs/common';
import { Readable } from 'stream';
import { TokenPayload } from '@/common/auth-token/auth-token.types';
import { RBAC_PERMISSIONS_KEY } from '@/modules/rbac/rbac.constants';
import { AdminTransformationHistoryController } from './admin-transformation-history.controller';
import {
  AdminTransformationHistoryQueryDto,
  TransformationHistoryQueryDto,
} from './dto/transformation-history.dto';
import { TransformationFileService } from './transformation-file.service';
import { TransformationHistoryService } from './transformation-history.service';

const ADMIN = { sub: 'admin-1', email: 'a@example.com' } as TokenPayload;
const USER_ID = '00000000-0000-4000-8000-00000000000b';
const ITEM = '00000000-0000-4000-8000-000000000001';

describe('AdminTransformationHistoryController', () => {
  const historyService = { listForAdmin: jest.fn() };
  const fileService = { download: jest.fn() };
  const controller = new AdminTransformationHistoryController(
    historyService as unknown as TransformationHistoryService,
    fileService as unknown as TransformationFileService,
  );
  const download = () => ({
    stream: Readable.from(['x']),
    mimeType: 'image/png',
    fileName: `transformed_${ITEM}.png`,
    size: 1,
  });

  beforeEach(() => jest.resetAllMocks());

  it('requires transformations.history@admin on the whole controller', () => {
    expect(
      Reflect.getMetadata(
        RBAC_PERMISSIONS_KEY,
        AdminTransformationHistoryController,
      ),
    ).toEqual(['transformations.history@admin']);
  });

  it('getGlobalHistory() passes the optional userId filter', async () => {
    const query = {
      limit: 10,
      userId: USER_ID,
    } as AdminTransformationHistoryQueryDto;

    historyService.listForAdmin.mockResolvedValue('page');

    await expect(controller.getGlobalHistory(ADMIN, query)).resolves.toBe(
      'page',
    );
    expect(historyService.listForAdmin).toHaveBeenCalledWith(
      'admin-1',
      query,
      USER_ID,
    );
  });

  it('getUserHistory() scopes to the path userId', async () => {
    const query = { limit: 10 } as TransformationHistoryQueryDto;

    historyService.listForAdmin.mockResolvedValue('page');

    await expect(
      controller.getUserHistory(ADMIN, USER_ID, query),
    ).resolves.toBe('page');
    expect(historyService.listForAdmin).toHaveBeenCalledWith(
      'admin-1',
      query,
      USER_ID,
    );
  });

  it('downloadAny() uses the admin scope without userId', async () => {
    fileService.download.mockResolvedValue(download());

    await expect(controller.downloadAny(ADMIN, ITEM)).resolves.toBeInstanceOf(
      StreamableFile,
    );
    expect(fileService.download).toHaveBeenCalledWith('admin-1', ITEM, {
      kind: 'admin',
    });
  });

  it('downloadUsers() uses the admin scope with the path userId', async () => {
    fileService.download.mockResolvedValue(download());

    await expect(
      controller.downloadUsers(ADMIN, USER_ID, ITEM),
    ).resolves.toBeInstanceOf(StreamableFile);
    expect(fileService.download).toHaveBeenCalledWith('admin-1', ITEM, {
      kind: 'admin',
      userId: USER_ID,
    });
  });
});
