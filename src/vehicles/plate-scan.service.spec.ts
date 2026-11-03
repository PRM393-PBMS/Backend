import { PlateRecognizerService } from '../integrations/plate-recognizer.service';
import { PlateScanService } from './plate-scan.service';

const image = (mimetype = 'image/jpeg', size = 1000) =>
  ({ buffer: Buffer.alloc(size), mimetype, originalname: 'bien-so.jpg' }) as never;

function setup(plate: string | null = '51A12345') {
  const recognize = jest.fn().mockResolvedValue({ licensePlate: plate, confidence: 0.92, candidates: [], provider: 'x' });
  return { service: new PlateScanService({ recognize } as unknown as PlateRecognizerService), recognize };
}

describe('Khách chụp biển số khi thêm xe', () => {
  it('đọc được thì trả biển số, không lưu ảnh (không truyền link ảnh)', async () => {
    const { service, recognize } = setup();
    const res = await service.scan('u1', image());
    expect(res.result).toEqual({ licensePlate: '51A12345', confidence: 0.92 });
    expect(recognize.mock.calls[0][1]).toBeNull();
  });

  it('không đọc được thì 422 kèm hướng dẫn chụp lại', async () => {
    const res = await setup(null).service.scan('u1', image());
    expect(res.statusCode).toBe(422);
  });

  it('thiếu ảnh, sai loại, quá 5MB thì từ chối, không gọi dịch vụ tính tiền', async () => {
    const { service, recognize } = setup();
    expect((await service.scan('u1', undefined)).isSuccess).toBe(false);
    expect((await service.scan('u1', image('application/pdf'))).isSuccess).toBe(false);
    expect((await service.scan('u1', image('image/jpeg', 6 * 1024 * 1024))).isSuccess).toBe(false);
    expect(recognize).not.toHaveBeenCalled();
  });

  it('quá 10 ảnh trong 10 phút thì 429; khách khác và sau 10 phút vẫn chụp được', async () => {
    const { service } = setup();
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) await service.scan('u1', image(), t0 + i);
    expect((await service.scan('u1', image(), t0 + 20)).statusCode).toBe(429);
    expect((await service.scan('u2', image(), t0 + 20)).isSuccess).toBe(true);
    expect((await service.scan('u1', image(), t0 + 10 * 60 * 1000 + 1)).isSuccess).toBe(true);
  });
});
