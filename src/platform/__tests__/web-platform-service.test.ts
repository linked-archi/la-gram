// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebPlatformService } from '../web-platform-service.js';

describe('WebPlatformService', () => {
  let service: WebPlatformService;

  beforeEach(() => {
    service = new WebPlatformService();
    // jsdom doesn't implement URL.createObjectURL / revokeObjectURL
    if (!URL.createObjectURL) {
      URL.createObjectURL = () => '';
    }
    if (!URL.revokeObjectURL) {
      URL.revokeObjectURL = () => {};
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isDesktop', () => {
    it('returns false', () => {
      expect(service.isDesktop()).toBe(false);
    });
  });

  describe('readFile', () => {
    it('reads content from a user-selected file', async () => {
      const fakeFile = new File(['hello world'], 'test.ttl', {
        type: 'text/turtle',
      });

      // Mock the file input element
      const clickSpy = vi.fn();
      vi.spyOn(document, 'createElement').mockReturnValue({
        type: '',
        accept: '',
        files: [fakeFile],
        addEventListener: (event: string, handler: () => void) => {
          if (event === 'change') {
            // Fire change immediately after click
            setTimeout(handler, 0);
          }
        },
        click: clickSpy,
      } as unknown as HTMLElement);

      const result = await service.readFile();
      expect(result.content).toBe('hello world');
      expect(result.name).toBe('test.ttl');
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('writeFile', () => {
    it('creates a download link and clicks it', async () => {
      const createObjectURLSpy = vi
        .spyOn(URL, 'createObjectURL')
        .mockReturnValue('blob:fake-url');
      const revokeObjectURLSpy = vi
        .spyOn(URL, 'revokeObjectURL')
        .mockImplementation(() => {});

      const clickSpy = vi.fn();
      const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
      const removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

      // Mock createElement to return a trackable anchor
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = originalCreateElement(tag);
        if (tag === 'a') {
          el.click = clickSpy;
        }
        return el;
      });

      await service.writeFile('<rdf data>', 'output.ttl');

      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:fake-url');
    });

    it('uses default filename when suggestedName is omitted', async () => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n);
      vi.spyOn(document.body, 'removeChild').mockImplementation((n) => n);

      let downloadAttr = '';
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = originalCreateElement(tag);
        if (tag === 'a') {
          el.click = vi.fn();
          const origSet = Object.getOwnPropertyDescriptor(
            HTMLAnchorElement.prototype,
            'download',
          )?.set;
          Object.defineProperty(el, 'download', {
            set(v: string) {
              downloadAttr = v;
              origSet?.call(el, v);
            },
            get() {
              return downloadAttr;
            },
          });
        }
        return el;
      });

      await service.writeFile('data');
      expect(downloadAttr).toBe('model.ttl');
    });
  });

  describe('showOpenDialog', () => {
    it('returns file name on selection', async () => {
      const fakeFile = new File([''], 'chosen.ttl');
      vi.spyOn(document, 'createElement').mockReturnValue({
        type: '',
        accept: '',
        files: [fakeFile],
        addEventListener: (event: string, handler: () => void) => {
          if (event === 'change') setTimeout(handler, 0);
        },
        click: vi.fn(),
      } as unknown as HTMLElement);

      const result = await service.showOpenDialog();
      expect(result).toBe('chosen.ttl');
    });

    it('returns null when no file is selected', async () => {
      vi.spyOn(document, 'createElement').mockReturnValue({
        type: '',
        accept: '',
        files: [],
        addEventListener: (event: string, handler: () => void) => {
          if (event === 'change') setTimeout(handler, 0);
        },
        click: vi.fn(),
      } as unknown as HTMLElement);

      const result = await service.showOpenDialog();
      expect(result).toBeNull();
    });

    it('sets accept attribute from filters', async () => {
      let acceptValue = '';
      const fakeFile = new File([''], 'test.ttl');
      vi.spyOn(document, 'createElement').mockReturnValue({
        type: '',
        set accept(v: string) {
          acceptValue = v;
        },
        get accept() {
          return acceptValue;
        },
        files: [fakeFile],
        addEventListener: (event: string, handler: () => void) => {
          if (event === 'change') setTimeout(handler, 0);
        },
        click: vi.fn(),
      } as unknown as HTMLElement);

      await service.showOpenDialog([
        { name: 'Turtle', extensions: ['ttl', 'turtle'] },
      ]);
      expect(acceptValue).toBe('.ttl,.turtle');
    });
  });

  describe('showSaveDialog', () => {
    it('returns a default filename', async () => {
      const result = await service.showSaveDialog();
      expect(result).toBe('model.ttl');
    });
  });
});
