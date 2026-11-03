import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FilesService, supabaseStorageConfig } from './payos-files.service';

const image = { buffer: Buffer.from('jpeg-bytes'), originalname: 'Bien So.JPG', mimetype: 'image/jpeg' };
const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STORAGE_BUCKET', 'UPLOAD_DIR'] as const;

describe('FilesService', () => {
  const saved: Record<string, string | undefined> = {};
  const realFetch = global.fetch;

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    global.fetch = realFetch;
  });

  it('cấu hình: cần cả URL và khoá; bucket mặc định pbms-uploads, bỏ dấu / cuối URL', () => {
    expect(supabaseStorageConfig({ SUPABASE_URL: 'https://x.supabase.co' })).toBeNull();
    expect(supabaseStorageConfig({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'k' })).toEqual({
      url: 'https://x.supabase.co',
      key: 'k',
      bucket: 'pbms-uploads',
    });
  });

  it('có Supabase: tạo bucket một lần, tải ảnh theo thư mục, trả URL công khai', async () => {
    process.env.SUPABASE_URL = 'https://abc.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const files = new FilesService();

    const first = await files.saveUpload(image, 'https://api.render.com', 'avatars');
    await files.saveUpload(image, 'https://api.render.com');

    const bucketCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/storage/v1/bucket'));
    expect(bucketCalls).toHaveLength(1);
    expect(JSON.parse(bucketCalls[0][1].body as string)).toMatchObject({ id: 'pbms-uploads', public: true, allowed_mime_types: ['image/*'] });

    expect(first.fileName).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(first.imageUrl).toBe(`https://abc.supabase.co/storage/v1/object/public/pbms-uploads/avatars/${first.fileName}`);
    const [uploadUrl, init] = fetchMock.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }];
    expect(uploadUrl).toBe(`https://abc.supabase.co/storage/v1/object/pbms-uploads/avatars/${first.fileName}`);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer service-key', apikey: 'service-key', 'Content-Type': 'image/jpeg' });
    // Ảnh không có thư mục con nằm ở gốc bucket.
    expect(String(fetchMock.mock.calls[2][0])).toMatch(/\/object\/pbms-uploads\/[0-9a-f-]{36}\.jpg$/);
  });

  it('Supabase từ chối thì báo lỗi rõ, không lặng lẽ ghi ra ổ đĩa', async () => {
    process.env.SUPABASE_URL = 'https://abc.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'bad-key';
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ message: 'Duplicate' }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: () => Promise.resolve({ message: 'Invalid JWT' }) }) as unknown as typeof fetch;
    await expect(new FilesService().saveUpload(image, 'http://localhost:3000')).rejects.toThrow(
      'Không lưu được ảnh lên Supabase Storage: Invalid JWT',
    );
  });

  it('mất mạng khi tạo bucket: lần sau thử tạo lại', async () => {
    process.env.SUPABASE_URL = 'https://abc.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const files = new FilesService();
    await files.saveUpload(image, '');
    await files.saveUpload(image, '');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/storage/v1/bucket'))).toHaveLength(2);
  });

  it('không cấu hình Supabase: ghi ra UPLOAD_DIR như trước', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pbms-up-'));
    process.env.UPLOAD_DIR = dir;
    global.fetch = jest.fn() as unknown as typeof fetch;
    try {
      const saved = await new FilesService().saveUpload(image, 'http://localhost:3000/', 'avatars');
      expect(saved.imageUrl).toBe(`http://localhost:3000/uploads/avatars/${saved.fileName}`);
      expect(await readFile(join(dir, 'avatars', saved.fileName), 'utf8')).toBe('jpeg-bytes');
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
