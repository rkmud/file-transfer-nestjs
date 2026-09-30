import { StreamableFile } from '@nestjs/common';
import { Readable } from 'stream';
import { TokenPayload } from '@/common/auth-token/auth-token.types';
import { TransformationHistoryQueryDto } from './dto/transformation-history.dto';
import { TransformationFileService } from './transformation-file.service';
import { TransformationHistoryController } from './transformation-history.controller';
import { TransformationHistoryService } from './transformation-history.service';

const USER = { sub: 'user-1', email: 'u@example.com' } as TokenPayload;
const ITEM = '00000000-0000-4000-8000-000000000001';

describe('TransformationHistoryController', () => {
  const historyService = { listOwn: jest.fn() };
  const fileService = { download: jest.fn() };
  const controller = new TransformationHistoryController(
    historyService as unknown as TransformationHistoryService,
    fileService as unknown as TransformationFileService,
  );

  beforeEach(() => jest.resetAllMocks());

  it('getOwnHistory() lists the caller history', async () => {
    const query = { limit: 5 } as TransformationHistoryQueryDto;
    const page = {
      items: [],
      pageInfo: { limit: 5, hasMore: false, nextCursor: null },
    };

    historyService.listOwn.mockResolvedValue(page);

    await expect(controller.getOwnHistory(USER, query)).resolves.toBe(page);
    expect(historyService.listOwn).toHaveBeenCalledWith('user-1', query);
  });

  it('downloadOwn() streams the caller file in self scope', async () => {
    fileService.download.mockResolvedValue({
      stream: Readable.from(['x']),
      mimeType: 'text/csv; charset=utf-8',
      fileName: `transformed_${ITEM}.csv`,
      size: 1,
    });

    const file = await controller.downloadOwn(USER, ITEM);

    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders().disposition).toBe(
      `attachment; filename="transformed_${ITEM}.csv"`,
    );
    expect(fileService.download).toHaveBeenCalledWith('user-1', ITEM, {
      kind: 'self',
    });
  });
});
