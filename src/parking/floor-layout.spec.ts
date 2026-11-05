import { PrismaService } from '../prisma/prisma.service';
import { FloorLayoutData, LayoutCell, canMove, layoutProblems, parseLayout, reachableDrivable } from './floor-layout';
import { FloorLayoutsService } from './floor-layouts.service';

const VT = '550e8400-e29b-41d4-a716-446655440000';
const F1 = '11111111-1111-4111-8111-111111111111';
const F2 = '22222222-2222-4222-8222-222222222222';

/** Tầng mẫu 8x4: cổng vào (0,1), lối đi hàng y=1, ô A01..A03 ở y=0, ô A04 bị tường chắn ở y=3. */
function sample(extra: LayoutCell[] = []): FloorLayoutData {
  return {
    w: 8,
    h: 4,
    cells: [
      { x: 0, y: 1, t: 'gate', name: 'Cổng 1', gateType: 'Entry' },
      ...[1, 2, 3, 4, 5].map((x) => ({ x, y: 1, t: 'road' as const })),
      ...[1, 2, 3].map((x) => ({ x, y: 0, t: 'slot' as const, code: `A0${x}`, vehicleTypeId: VT })),
      ...extra,
    ],
  };
}

describe('Định dạng sơ đồ', () => {
  it('nhận sơ đồ hợp lệ, viết hoa mã ô, bỏ trường lạ', () => {
    const parsed = parseLayout({ ...sample(), cells: [{ x: 1, y: 0, t: 'slot', code: 'a01', vehicleTypeId: VT, hack: 1 }] });
    expect(typeof parsed).toBe('object');
    expect((parsed as FloorLayoutData).cells[0]).toEqual({ x: 1, y: 0, t: 'slot', code: 'A01', vehicleTypeId: VT, slotId: undefined });
  });

  it.each([
    [{ w: 2, h: 5, cells: [] }, 'Kích thước'],
    [{ w: 8, h: 4, cells: [{ x: 9, y: 0, t: 'road' }] }, 'ngoài lưới'],
    [{ w: 8, h: 4, cells: [{ x: 1, y: 1, t: 'road' }, { x: 1, y: 1, t: 'wall' }] }, 'hai lần'],
    [{ w: 8, h: 4, cells: [{ x: 1, y: 1, t: 'lava' }] }, 'Loại ô'],
    [{ w: 8, h: 4, cells: [{ x: 1, y: 1, t: 'slot', vehicleTypeId: VT }] }, 'cần mã'],
    [{ w: 8, h: 4, cells: [{ x: 1, y: 1, t: 'slot', code: 'A1' }] }, 'loại xe'],
    [{ w: 8, h: 4, cells: [{ x: 1, y: 1, t: 'gate' }] }, 'chưa có tên'],
    [{ w: 8, h: 4, cells: [{ x: 1, y: 1, t: 'ramp' }] }, 'tầng nối tới'],
  ])('từ chối %o', (raw, msg) => {
    expect(parseLayout(raw)).toContain(msg);
  });
});

describe('Lối đi và kiểm tra trước khi xuất bản', () => {
  it('lối một chiều: chỉ đi theo hướng mũi tên, không đi ngược vào', () => {
    const road = (dir?: 'E' | 'W'): LayoutCell => ({ x: 0, y: 0, t: 'road', dir });
    expect(canMove(road('E'), road(), 'E')).toBe(true);
    expect(canMove(road('E'), road(), 'W')).toBe(false);
    expect(canMove(road(), road('W'), 'E')).toBe(false);
    expect(canMove(road(), { x: 0, y: 0, t: 'wall' }, 'E')).toBe(false);
  });

  it('sơ đồ mẫu hợp lệ; mọi ô đỗ cạnh lối đi tới được từ cổng', () => {
    expect(reachableDrivable(sample()).has('5,1')).toBe(true);
    expect(layoutProblems(sample(), new Set([F1]), F1)).toEqual([]);
  });

  it('ô đỗ không có lối tới thì báo tên ô', () => {
    const layout = sample([{ x: 7, y: 3, t: 'slot', code: 'A04', vehicleTypeId: VT }]);
    expect(layoutProblems(layout, new Set([F1]), F1)[0]).toContain('Chưa có lối đi tới: A04');
  });

  it('lối một chiều ngược hướng làm ô phía sau không tới được', () => {
    const layout = sample();
    layout.cells.find((c) => c.x === 2 && c.y === 1)!.dir = 'W';
    expect(layoutProblems(layout, new Set([F1]), F1)[0]).toContain('A03');
  });

  it('trùng mã, thiếu cổng, dốc trỏ sai tầng', () => {
    const dup = sample([{ x: 4, y: 0, t: 'slot', code: 'A01', vehicleTypeId: VT }]);
    expect(layoutProblems(dup, new Set([F1]), F1)).toContain('Mã ô A01 bị dùng 2 lần');
    const noGate = { ...sample(), cells: sample().cells.filter((c) => c.t !== 'gate') };
    expect(layoutProblems(noGate, new Set([F1]), F1)[0]).toContain('chưa có cổng vào');
    const badRamp = sample([{ x: 6, y: 1, t: 'ramp', to: F1 }]);
    expect(layoutProblems(badRamp, new Set([F1, F2]), F1)[0]).toContain('tầng khác');
  });

  it('dốc từ tầng khác cũng là lối vào (tầng hầm không có cổng)', () => {
    const basement: FloorLayoutData = {
      w: 6,
      h: 3,
      cells: [
        { x: 0, y: 1, t: 'ramp', to: F1 },
        { x: 1, y: 1, t: 'road' },
        { x: 1, y: 0, t: 'slot', code: 'B01', vehicleTypeId: VT },
      ],
    };
    expect(layoutProblems(basement, new Set([F1, F2]), F2)).toEqual([]);
  });
});

describe('Xuất bản sơ đồ', () => {
  function setup(opts: { existing?: object[]; version?: number; held?: object[] } = {}) {
    const existing = opts.existing ?? [];
    const tx = {
      parkingSlot: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(existing)
          .mockImplementation((a: { where: { slotCode?: { in: string[] } } }) =>
            Promise.resolve((a.where.slotCode?.in ?? []).map((code) => ({ id: `new-${code}`, slotCode: code }))),
          ),
        deleteMany: jest.fn(),
        update: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      monthlySubscription: { findMany: jest.fn().mockResolvedValue(opts.held ?? []) },
      gate: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'gate-new' }) },
      floor: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      floor: {
        findUnique: jest.fn().mockResolvedValue({
          id: F1, parkingId: 'lot', layoutVersion: opts.version ?? 3, layoutDraft: sample(), layout: null,
        }),
        findMany: jest.fn().mockResolvedValue([{ id: F1 }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      vehicleType: { findMany: jest.fn().mockResolvedValue([{ id: VT }]) },
      parkingSlot: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>, _options?: object) => fn(tx)),
    };
    return { service: new FloorLayoutsService(prisma as unknown as PrismaService), tx, prisma };
  }

  it('tạo ô và cổng mới, ghi id vào sơ đồ, cập nhật sức chứa, tăng version', async () => {
    const { service, tx, prisma } = setup();
    const res = await service.publish(F1, { version: 3 });
    expect(res.isSuccess).toBe(true);
    // Giao dịch đủ dài cho DB ở xa (mặc định Prisma chỉ 5 giây).
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({ timeout: 30_000, maxWait: 10_000 });
    expect(tx.parkingSlot.createMany.mock.calls[0][0].data.map((d: { slotCode: string }) => d.slotCode)).toEqual(['A01', 'A02', 'A03']);
    const saved = (res.result as { layout: FloorLayoutData }).layout;
    expect(saved.cells.find((c) => c.code === 'A02')?.slotId).toBe('new-A02');
    expect(saved.cells.find((c) => c.t === 'gate')?.gateId).toBe('gate-new');
    expect(tx.floor.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: F1, layoutVersion: 3 },
      data: { layoutVersion: 4, totalCapacity: 3 },
    });
  });

  it('ô cũ cùng mã được giữ (không tạo lại); ô cũ không còn trên sơ đồ thì xoá', async () => {
    const { service, tx } = setup({
      existing: [
        { id: 's1', slotCode: 'A01', vehicleTypeId: VT, status: 'Available' },
        { id: 's9', slotCode: 'Z09', vehicleTypeId: VT, status: 'Available' },
      ],
    });
    await service.publish(F1, { version: 3 });
    expect(tx.parkingSlot.createMany.mock.calls[0][0].data).toHaveLength(2);
    expect(tx.parkingSlot.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['s9'] } } });
  });

  it('không xoá ô đang có xe hoặc giữ cho vé tháng', async () => {
    const { service, tx } = setup({
      existing: [
        { id: 's8', slotCode: 'Z08', vehicleTypeId: VT, status: 'Occupied' },
        { id: 's9', slotCode: 'Z09', vehicleTypeId: VT, status: 'Available' },
      ],
      held: [{ fixedSlotId: 's9' }],
    });
    const res = await service.publish(F1, { version: 3 });
    expect(res.statusCode).toBe(400);
    expect((res.result as { problems: string[] }).problems[0]).toContain('Z08, Z09');
    expect(tx.parkingSlot.deleteMany).not.toHaveBeenCalled();
  });

  it('đổi mã hai ô cho nhau đi qua mã tạm (không vướng mã duy nhất)', async () => {
    const { service, tx, prisma } = setup({
      existing: [
        { id: 's1', slotCode: 'A01', vehicleTypeId: VT, status: 'Available' },
        { id: 's2', slotCode: 'A02', vehicleTypeId: VT, status: 'Available' },
      ],
    });
    const swapped = sample();
    swapped.cells.find((c) => c.code === 'A01')!.slotId = 's2';
    swapped.cells.find((c) => c.code === 'A02')!.slotId = 's1';
    prisma.floor.findUnique.mockResolvedValue({ id: F1, parkingId: 'lot', layoutVersion: 3, layoutDraft: swapped, layout: null });
    await service.publish(F1, { version: 3 });
    const codes = tx.parkingSlot.update.mock.calls.map((c: [{ data: { slotCode: string } }]) => c[0].data.slotCode);
    expect(codes.slice(0, 2).every((c: string) => c.startsWith('~'))).toBe(true);
    expect(codes.slice(2)).toEqual(['A01', 'A02']);
  });

  it('sai version thì 409, không đụng dữ liệu', async () => {
    const { service, tx } = setup({ version: 5 });
    const res = await service.publish(F1, { version: 3 });
    expect(res.statusCode).toBe(409);
    expect(tx.parkingSlot.createMany).not.toHaveBeenCalled();
  });

  it('lưu nháp chỉ khi đúng version', async () => {
    const { service, prisma } = setup();
    prisma.floor.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await service.saveDraft(F1, { version: 1, layout: sample() })).statusCode).toBe(409);
    expect((await service.saveDraft(F1, { version: 3, layout: sample() })).isSuccess).toBe(true);
    expect((await service.saveDraft(F1, { version: 3, layout: { w: 1 } })).isSuccess).toBe(false);
  });
});

describe('Lỗi bất ngờ khi lưu sơ đồ', () => {
  it('trả lý do thật (500 kèm thông điệp) thay vì Internal server error', async () => {
    const prisma = {
      floor: {
        findUnique: jest.fn().mockResolvedValue({ id: F1, parkingId: 'lot', layoutVersion: 3, layoutDraft: sample(), layout: null }),
        findMany: jest.fn().mockResolvedValue([{ id: F1 }]),
        updateMany: jest.fn().mockRejectedValue(new Error('Transaction already closed: timeout 5000 ms')),
      },
      vehicleType: { findMany: jest.fn().mockResolvedValue([{ id: VT }]) },
      parkingSlot: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockRejectedValue(new Error('Transaction already closed: timeout 5000 ms')),
    };
    const service = new FloorLayoutsService(prisma as unknown as PrismaService);
    const draft = await service.saveDraft(F1, { version: 3, layout: sample() });
    expect(draft.statusCode).toBe(500);
    expect(draft.message).toBe('Đã có sự cố xảy ra. Vui lòng thử lại sau.');
    expect(draft.message).not.toContain('Transaction already closed');
    const published = await service.publish(F1, { version: 3 });
    expect(published.statusCode).toBe(500);
    expect(published.message).toBe('Đã có sự cố xảy ra. Vui lòng thử lại sau.');
  });
});
