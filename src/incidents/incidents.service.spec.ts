import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { IncidentsService } from './incidents.service';

describe('IncidentsService', () => {
  const userId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const incident = (over: Record<string, unknown> = {}) => ({
    id: 'inc-1',
    sessionId: null,
    reportedByUserId: userId,
    reportedByUser: { fullName: 'Khách' },
    issueType: 'SlotOccupied',
    description: 'Ô bị chiếm',
    proofImageUrl: null,
    status: 'Open',
    handledByStaffId: null,
    handledByStaff: null,
    resolvedAt: null,
    resolutionNotes: null,
    createdAt: new Date('2026-10-20T08:00:00Z'),
    ...over,
  });
  let prisma: { incidentReport: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock } };
  let notifications: { notify: jest.Mock };
  let service: IncidentsService;

  beforeEach(() => {
    prisma = {
      incidentReport: {
        findMany: jest.fn().mockResolvedValue([incident()]),
        findUnique: jest.fn().mockResolvedValue(incident()),
        create: jest.fn().mockResolvedValue(incident()),
        update: jest.fn((args: { data: Record<string, unknown> }) => Promise.resolve(incident(args.data))),
      },
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    service = new IncidentsService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );
  });

  it('sự cố của tôi: mới nhất trước theo createdAt và trả createdAt', async () => {
    const res = await service.getMine(userId);
    expect(prisma.incidentReport.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect((res.result as Array<{ createdAt: Date }>)[0].createdAt).toEqual(new Date('2026-10-20T08:00:00Z'));
  });

  it('khách tạo báo cáo: luôn Open, không tự gán người xử lý', async () => {
    await service.create(userId, { issueType: 'X', description: 'Y', status: 'Resolved', handledByStaffId: userId });
    const data = prisma.incidentReport.create.mock.calls[0][0].data;
    expect(data.status).toBe('Open');
    expect(data).not.toHaveProperty('handledByStaffId');
  });

  it('khách huỷ báo cáo đang chờ của mình', async () => {
    const res = await service.cancel('inc-1', userId);
    expect(res.isSuccess).toBe(true);
    expect(prisma.incidentReport.update.mock.calls[0][0].data).toEqual({ status: 'Cancelled' });
  });

  it('không huỷ được báo cáo của người khác hoặc đã xử lý', async () => {
    expect((await service.cancel('inc-1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).statusCode).toBe(403);
    prisma.incidentReport.findUnique.mockResolvedValue(incident({ status: 'Resolved' }));
    expect((await service.cancel('inc-1', userId)).statusCode).toBe(400);
    expect(prisma.incidentReport.update).not.toHaveBeenCalled();
  });

  it('nhân viên nhận và xử lý xong đều báo cho người báo', async () => {
    await service.assign('inc-1', 'staff-1');
    await service.resolve('inc-1', 'staff-1', { resolutionNotes: 'Đã giải phóng ô' });
    expect(notifications.notify).toHaveBeenNthCalledWith(
      1,
      userId,
      expect.objectContaining({ type: 'incident', metadata: { incidentId: 'inc-1', status: 'InProgress' } }),
    );
    expect(notifications.notify).toHaveBeenNthCalledWith(
      2,
      userId,
      expect.objectContaining({ message: expect.stringContaining('Đã giải phóng ô') }),
    );
  });
});
