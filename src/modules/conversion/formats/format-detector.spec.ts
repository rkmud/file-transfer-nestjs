import { ConversionError } from './conversion-error';
import { CsvFormatHandler } from './csv.format';
import { detectSourceFormat } from './format-detector';
import { TextFormatHandler } from './format-handler';
import { createFormatRegistry, FormatRegistry } from './format-registry';
import { FormatMatch } from './format.types';

const registry = createFormatRegistry();

const detect = (fileName: string, head: string | Buffer): string =>
  detectSourceFormat(
    registry,
    fileName,
    typeof head === 'string' ? Buffer.from(head, 'utf8') : head,
  ).format;

const expectUnsupported = (fn: () => unknown, message: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ConversionError);
    expect(error).toMatchObject({ code: 'UNSUPPORTED_FORMAT', message });

    return;
  }

  throw new Error('expected UNSUPPORTED_FORMAT');
};

describe('detectSourceFormat', () => {
  describe('extension and content agree', () => {
    it.each([
      ['data.csv', 'a,b\n1,2', 'csv'],
      ['data.json', '{"a":1}', 'json'],
      ['data.xml', '<a/>', 'xml'],
      ['data.yaml', 'a: 1', 'yaml'],
      ['data.yml', '---\na: 1', 'yaml'],
      ['DATA.JSON', '[1]', 'json'],
      ['archive.tar.csv', 'x', 'csv'],
    ])('%s -> %s', (fileName, head, expected) => {
      expect(detect(fileName, head)).toBe(expected);
    });

    it('ignores a BOM and leading whitespace in the head', () => {
      expect(
        detect(
          'data.xml',
          Buffer.concat([
            Buffer.from([0xef, 0xbb, 0xbf]),
            Buffer.from('\n  <a/>'),
          ]),
        ),
      ).toBe('xml');
    });

    it('trusts the extension when the content is only possible for it', () => {
      // CSV sniffs this as Possible and YAML as Likely; the extension wins.
      expect(detect('data.csv', 'name: value')).toBe('csv');
    });
  });

  describe('extension and content disagree', () => {
    it.each([
      ['data.json', 'a,b\n1,2'],
      ['data.xml', '{"a":1}'],
      ['data.csv', '<a/>'],
      ['data.csv', '[1,2]'],
      ['data.yaml', '<root/>'],
    ])('%s with %j -> UNSUPPORTED_FORMAT', (fileName, head) => {
      const extension = fileName.slice(fileName.lastIndexOf('.'));

      expectUnsupported(
        () => detect(fileName, head),
        `File content does not match the ${extension} extension`,
      );
    });
  });

  describe('extension unknown', () => {
    it.each(['data.exe', 'data.xlsx', 'photo.png', 'data.'])(
      '%s is rejected regardless of content',
      (fileName) => {
        const extension = fileName.slice(fileName.lastIndexOf('.'));

        expectUnsupported(
          () => detect(fileName, '{"a":1}'),
          `Unsupported source file extension ${extension}`,
        );
      },
    );

    it.each([
      ['data', '{"a":1}', 'json'],
      ['data.txt', '[1,2]', 'json'],
      ['notes.TXT', '<root/>', 'xml'],
      ['data.txt', '---\na: 1', 'yaml'],
      ['data.txt', 'a: 1\nb: 2', 'yaml'],
      ['data.txt', 'a,b\n1,2', 'csv'],
      ['data.txt', 'plain', 'csv'],
      ['data.txt', '42', 'csv'],
    ])(
      'a generic name (%s) is decided by content %j -> %s',
      (f, head, expected) => {
        expect(detect(f, head)).toBe(expected);
      },
    );
  });

  describe('content undecidable', () => {
    it.each([
      ['data.txt', ''],
      ['data', '   \n\t'],
      ['data.txt', '﻿'],
    ])('%s with %j -> UNSUPPORTED_FORMAT', (fileName, head) => {
      expectUnsupported(
        () => detect(fileName, head),
        'Unable to detect the source format',
      );
    });

    it('fails when no handler recognises the content at all', () => {
      class NeverHandler extends CsvFormatHandler {
        sniff(): FormatMatch {
          return FormatMatch.No;
        }
      }

      const never = new FormatRegistry([
        new NeverHandler() as TextFormatHandler,
      ]);

      expectUnsupported(
        () => detectSourceFormat(never, 'data.txt', Buffer.from('x')),
        'Unable to detect the source format',
      );
    });
  });
});
