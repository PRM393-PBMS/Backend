import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { VehiclesService } from './vehicles.service';

describe('VehiclesService: tên xe và mẫu xe', () => {
  const userId = '0b6f3c6e-6a64-4c1c-9d5a-2b9c7f3f1a11';
  const vehicleId = '6e2c1c43-5d8a-4b7e-9a39-0f6c4f2d8b22';
  const vehicleTypeId = '3f1d2a9b-7c4e-4f60-8a1b-5e2d9c7b6a33';
  const stored = {
    id: vehicleId,
    userId,
    vehicleTypeId,
    licensePlate: '51H12345',
    nickname: null as string | null,
    modelName: null as string | null,
    vehicleType: { typeName: 'Ô tô' },
  };

  let service: VehiclesService;
  let prisma: {
    vehicle: { create: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    monthlySubscription: { count: jest.Mock };
    reservation: { count: jest.Mock };
    parkingSession: { count: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      vehicle: {
        create: jest.fn(({ data }) => Promise.resolve({ ...stored, ...data })),
        findFirst: jest.fn().mockResolvedValue(stored),
        update: jest.fn(({ data }) => Promise.resolve({ ...stored, ...data })),
      },
      monthlySubscription: { count: jest.fn().mockResolvedValue(1) },
      reservation: { count: jest.fn().mockResolvedValue(0) },
      parkingSession: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((ops: Promise<number>[]) => Promise.all(ops)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [VehiclesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(VehiclesService);
  });

  it('lưu tên tự đặt và mẫu xe khi đăng ký xe, cắt khoảng trắng thừa', async () => {
    const res = await service.create(userId, {
      vehicleTypeId,
      licensePlate: '51H-123.45',
      nickname: '  Xe   của mẹ ',
      ModelName: 'Toyota Vios 2020',
    });

    expect(res.isSuccess).toBe(true);
    expect(prisma.vehicle.create.mock.calls[0][0].data).toMatchObject({
      nickname: 'Xe của mẹ',
      modelName: 'Toyota Vios 2020',
    });
    expect(res.result).toMatchObject({ nickname: 'Xe của mẹ', modelName: 'Toyota Vios 2020' });
  });

  it('trả null khi xe chưa có tên / mẫu', async () => {
    const res = await service.getById(userId, vehicleId);
    expect(res.result).toMatchObject({ nickname: null, modelName: null });
  });

  it('từ chối tên quá dài', async () => {
    const res = await service.create(userId, {
      vehicleTypeId,
      licensePlate: '51H12345',
      nickname: 'x'.repeat(41),
    });
    expect(res.isSuccess).toBe(false);
    expect(res.message).toContain('40');
    expect(prisma.vehicle.create).not.toHaveBeenCalled();
  });

  it('cho đổi tên / mẫu xe kể cả khi xe đang có gói tháng', async () => {
    const res = await service.update(userId, vehicleId, { modelName: 'Honda City' });

    expect(res.isSuccess).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.vehicle.update.mock.calls[0][0].data).toEqual({
      licensePlate: '51H12345',
      modelName: 'Honda City',
    });
  });

  it('chuỗi rỗng thì xoá tên tự đặt', async () => {
    await service.update(userId, vehicleId, { nickname: '' });
    expect(prisma.vehicle.update.mock.calls[0][0].data).toMatchObject({ nickname: null });
  });

  it('vẫn chặn đổi biển số khi xe có gói tháng', async () => {
    const res = await service.update(userId, vehicleId, {
      licensePlate: '51H99999',
      nickname: 'Xe mới',
    });
    expect(res.statusCode).toBe(409);
    expect(prisma.vehicle.update).not.toHaveBeenCalled();
  });
});
