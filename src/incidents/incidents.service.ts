import {
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import {
  isEmptyGuid,
  pbmsPick,
  pbmsPickGuid,
  sameStatus,
} from '../common/pbms-fields';
import { NotificationsService } from '../notifications/notifications.service';

/** Mới nhất trước; id phá hoà khi cùng thời điểm. */
const NEWEST_FIRST = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async getAll(): Promise<PbmsResponseDto> {
    const items = await this.prisma.incidentReport.findMany({
      include: this.include(),
      orderBy: NEWEST_FIRST,
    });
    return PbmsResponseDto.ok(
      'Lấy danh sách sự cố thành công',
      items.map((item) => this.map(item)),
    );
  }

  async getById(
    id: string,
    userId: string,
    role: string,
  ): Promise<PbmsResponseDto> {
    const item = await this.prisma.incidentReport.findUnique({
      where: { id },
      include: this.include(),
    });
    if (!item) {
      return PbmsResponseDto.fail('Không tìm thấy sự cố', 404);
    }
    if (!this.canStaff(role) && item.reportedByUserId !== userId) {
      throw new ForbiddenException();
    }
    return PbmsResponseDto.ok('Lấy sự cố thành công', this.map(item));
  }

  async getAssignees(): Promise<PbmsResponseDto> {
    const users = await this.prisma.user.findMany({
      where: {
        status: 'Active',
        pbmsRole: { roleName: { in: ['staff', 'manager'] } },
      },
      include: { pbmsRole: true },
    });
    return PbmsResponseDto.ok(
      'Lấy danh sách người xử lý thành công',
      users.map((user) => ({
        userId: user.id,
        fullName: user.fullName,
        roleName: user.pbmsRole?.roleName,
      })),
    );
  }

  async getMine(userId: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(userId)) {
      throw new UnauthorizedException({ message: 'Vui lòng đăng nhập' });
    }
    const items = await this.prisma.incidentReport.findMany({
      where: { reportedByUserId: userId },
      include: this.include(),
      orderBy: NEWEST_FIRST,
    });
    return PbmsResponseDto.ok(
      'Lấy sự cố của tôi thành công',
      items.map((item) => this.map(item)),
    );
  }

  async create(
    userId: string,
    dto: object,
    role = '',
  ): Promise<PbmsResponseDto> {
    const issueType = pbmsPick(dto, 'issueType', 'IssueType').trim();
    const description = pbmsPick(dto, 'description', 'Description').trim();
    if (!issueType || !description) {
      return PbmsResponseDto.fail('Vui lòng nhập loại sự cố và mô tả');
    }
    const sessionId = pbmsPickGuid(dto, 'sessionId', 'SessionId') || null;
    if (
      sessionId &&
      !(await this.prisma.parkingSession.findFirst({
        where: {
          id: sessionId,
          ...(!this.canStaff(role) ? { vehicle: { userId } } : {}),
        },
        select: { id: true },
      }))
    )
      return PbmsResponseDto.fail('Không tìm thấy lượt gửi xe của bạn', 404);
    const item = await this.prisma.incidentReport.create({
      data: {
        sessionId,
        reportedByUserId:
          userId || pbmsPickGuid(dto, 'reportedByUserId', 'ReportedByUserId'),
        issueType,
        description,
        proofImageUrl:
          pbmsPick(dto, 'proofImageUrl', 'ProofImageUrl').trim() || null,
        // Trạng thái và người xử lý do bãi quyết định, khách không tự đặt.
        status: 'Open',
      },
      include: this.include(),
    });
    return PbmsResponseDto.ok(
      'Tạo báo cáo sự cố thành công',
      this.map(item),
      201,
    );
  }

  async update(dto: object): Promise<PbmsResponseDto> {
    const id = pbmsPickGuid(dto, 'incidentId', 'IncidentId');
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Dữ liệu cập nhật không hợp lệ');
    }
    const existing = await this.prisma.incidentReport.findUnique({
      where: { id },
    });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy sự cố', 404);
    }
    const nextStatus =
      pbmsPick(dto, 'status', 'Status').trim() || existing.status;
    if (
      !['Open', 'InProgress', 'Resolved', 'Cancelled'].includes(nextStatus) ||
      (['Resolved', 'Cancelled'].includes(existing.status) &&
        nextStatus !== existing.status) ||
      (existing.status === 'InProgress' && nextStatus === 'Open')
    )
      return PbmsResponseDto.fail(
        'Không thể mở lại báo cáo đã xử lý hoặc đã hủy.',
        409,
      );
    const handler = pbmsPickGuid(dto, 'handledByStaffId', 'HandledByStaffId');
    if (handler && !(await this.validHandler(handler)))
      return PbmsResponseDto.fail(
        'Vui lòng chọn nhân viên đang hoạt động',
        400,
      );
    const item = await this.change(id, [existing.status], {
      sessionId:
        pbmsPickGuid(dto, 'sessionId', 'SessionId') || existing.sessionId,
      issueType:
        pbmsPick(dto, 'issueType', 'IssueType').trim() || existing.issueType,
      description:
        pbmsPick(dto, 'description', 'Description').trim() ||
        existing.description,
      proofImageUrl:
        pbmsPick(dto, 'proofImageUrl', 'ProofImageUrl').trim() ||
        existing.proofImageUrl,
      status: pbmsPick(dto, 'status', 'Status').trim() || existing.status,
      handledByStaffId:
        pbmsPickGuid(dto, 'handledByStaffId', 'HandledByStaffId') ||
        existing.handledByStaffId,
      resolutionNotes:
        pbmsPick(dto, 'resolutionNotes', 'ResolutionNotes').trim() ||
        existing.resolutionNotes,
    });
    if (!item)
      return PbmsResponseDto.fail(
        'Báo cáo vừa thay đổi. Vui lòng tải lại.',
        409,
      );

    return PbmsResponseDto.ok('Cập nhật sự cố thành công', this.map(item));
  }

  async assign(id: string, staffId: string): Promise<PbmsResponseDto> {
    const existing = await this.prisma.incidentReport.findUnique({
      where: { id },
    });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy sự cố', 404);
    }
    if (!(await this.validHandler(staffId)))
      return PbmsResponseDto.fail(
        'Vui lòng chọn nhân viên đang hoạt động',
        400,
      );
    const item = await this.change(id, ['Open'], {
      handledByStaffId: staffId,
      status: 'InProgress',
    });
    if (!item)
      return PbmsResponseDto.fail(
        'Báo cáo đã được tiếp nhận, xử lý hoặc hủy. Vui lòng tải lại.',
        409,
      );
    await this.notifications?.notify(item.reportedByUserId, {
      title: 'Sự cố đang được xử lý',
      message: `Báo cáo "${this.issueLabel(item.issueType)}" đã được nhân viên ${item.handledByStaff?.fullName ?? 'bãi xe'} tiếp nhận.`,
      type: 'incident',
      metadata: { incidentId: id, status: 'InProgress' },
    });
    return PbmsResponseDto.ok('Gán nhân viên xử lý thành công', this.map(item));
  }

  async resolve(
    id: string,
    staffId: string,
    dto: object,
  ): Promise<PbmsResponseDto> {
    const existing = await this.prisma.incidentReport.findUnique({
      where: { id },
    });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy sự cố', 404);
    }
    const notes = pbmsPick(dto, 'resolutionNotes', 'ResolutionNotes').trim();
    if (!notes) {
      return PbmsResponseDto.fail('Vui lòng nhập ghi chú xử lý');
    }
    if (!(await this.validHandler(staffId)))
      return PbmsResponseDto.fail(
        'Vui lòng chọn nhân viên đang hoạt động',
        400,
      );
    const item = await this.change(id, ['Open', 'InProgress'], {
      handledByStaffId: staffId,
      resolutionNotes: notes,
      status: 'Resolved',
      resolvedAt: new Date(),
    });
    if (!item)
      return PbmsResponseDto.fail(
        'Báo cáo đã xử lý hoặc đã hủy. Vui lòng tải lại.',
        409,
      );
    await this.notifications?.notify(item.reportedByUserId, {
      title: 'Sự cố đã được xử lý',
      message: `Báo cáo "${this.issueLabel(item.issueType)}" đã xử lý xong. Ghi chú: ${notes}`,
      type: 'incident',
      metadata: { incidentId: id, status: 'Resolved' },
    });
    return PbmsResponseDto.ok('Đã xử lý sự cố thành công', this.map(item));
  }

  /** Khách tự huỷ báo cáo của mình khi bãi chưa xử lý xong. */
  async cancel(id: string, userId: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(userId)) {
      return PbmsResponseDto.fail('Vui lòng đăng nhập', 401);
    }
    const existing = await this.prisma.incidentReport.findUnique({
      where: { id },
    });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy sự cố', 404);
    }
    if (existing.reportedByUserId !== userId) {
      return PbmsResponseDto.fail('Bạn không có quyền huỷ báo cáo này', 403);
    }
    if (
      !sameStatus(existing.status, 'Open') &&
      !sameStatus(existing.status, 'InProgress')
    ) {
      return PbmsResponseDto.fail(
        'Chỉ huỷ được báo cáo đang chờ hoặc đang xử lý',
      );
    }
    const item = await this.change(id, ['Open', 'InProgress'], {
      status: 'Cancelled',
    });
    if (!item)
      return PbmsResponseDto.fail(
        'Báo cáo vừa được xử lý hoặc hủy. Vui lòng tải lại.',
        409,
      );
    return PbmsResponseDto.ok('Đã huỷ báo cáo sự cố', this.map(item));
  }

  async remove(id: string): Promise<PbmsResponseDto> {
    const existing = await this.prisma.incidentReport.findUnique({
      where: { id },
    });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy sự cố', 404);
    }
    try {
      await this.prisma.incidentReport.delete({ where: { id } });
      return PbmsResponseDto.ok('Xóa sự cố thành công');
    } catch (error: unknown) {
      return PbmsResponseDto.fromError(error);
    }
  }

  private async change(
    id: string,
    statuses: string[],
    data: Prisma.IncidentReportUncheckedUpdateManyInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const moved = await tx.incidentReport.updateMany({
        where: { id, status: { in: statuses } },
        data,
      });
      return moved.count === 1
        ? tx.incidentReport.findUnique({
            where: { id },
            include: this.include(),
          })
        : null;
    });
  }
  private validHandler(id: string) {
    return this.prisma.user.findFirst({
      where: {
        id,
        isActive: true,
        status: 'Active',
        pbmsRole: { roleName: { in: ['staff', 'manager'] } },
      },
      select: { id: true },
    });
  }
  private issueLabel(type: string) {
    return (
      (
        {
          SlotOccupied: 'Ô đỗ bị chiếm',
          VehicleDamage: 'Xe bị hư hỏng',
          LostItem: 'Thất lạc đồ',
          PaymentIssue: 'Vấn đề thanh toán',
          Other: 'Sự cố khác',
        } as Record<string, string>
      )[type] ?? 'Sự cố đã báo'
    );
  }
  private canStaff(role: string): boolean {
    const value = role.trim().toLowerCase();
    return value === 'manager' || value === 'staff';
  }

  private include() {
    return { reportedByUser: true, handledByStaff: true };
  }

  private map(item: {
    id: string;
    sessionId: string | null;
    reportedByUserId: string;
    reportedByUser: { fullName: string | null };
    issueType: string;
    description: string;
    proofImageUrl: string | null;
    status: string;
    handledByStaffId: string | null;
    handledByStaff: { fullName: string | null } | null;
    resolvedAt: Date | null;
    resolutionNotes: string | null;
    createdAt: Date;
  }) {
    return {
      incidentId: item.id,
      sessionId: item.sessionId,
      reportedByUserId: item.reportedByUserId,
      reportedByUserFullName: item.reportedByUser.fullName,
      issueType: item.issueType,
      description: item.description,
      proofImageUrl: item.proofImageUrl,
      status: item.status,
      handledByStaffId: item.handledByStaffId,
      handledByStaffFullName: item.handledByStaff?.fullName ?? null,
      resolvedAt: item.resolvedAt,
      resolutionNotes: item.resolutionNotes,
      createdAt: item.createdAt,
    };
  }
}
