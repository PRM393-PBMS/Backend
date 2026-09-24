import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { errorMessage, isEmptyGuid, pbmsPick, pbmsPickGuid } from '../common/pbms-fields';

@Injectable()
export class IncidentsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<PbmsResponseDto> {
    const items = await this.prisma.incidentReport.findMany({
      include: this.include(),
      orderBy: { id: 'desc' },
    });
    if (items.length === 0) {
      return PbmsResponseDto.fail('Không có sự cố nào trong hệ thống', 404);
    }
    return PbmsResponseDto.ok('Lấy danh sách sự cố thành công', items.map((item) => this.map(item)));
  }

  async getById(id: string, userId: string, role: string): Promise<PbmsResponseDto> {
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
      orderBy: { id: 'desc' },
    });
    return PbmsResponseDto.ok('Lấy sự cố của tôi thành công', items.map((item) => this.map(item)));
  }

  async create(userId: string, dto: object): Promise<PbmsResponseDto> {
    const issueType = pbmsPick(dto, 'issueType', 'IssueType').trim();
    const description = pbmsPick(dto, 'description', 'Description').trim();
    if (!issueType || !description) {
      return PbmsResponseDto.fail('Vui lòng nhập loại sự cố và mô tả');
    }
    const item = await this.prisma.incidentReport.create({
      data: {
        sessionId: pbmsPickGuid(dto, 'sessionId', 'SessionId') || null,
        reportedByUserId: userId || pbmsPickGuid(dto, 'reportedByUserId', 'ReportedByUserId'),
        issueType,
        description,
        proofImageUrl: pbmsPick(dto, 'proofImageUrl', 'ProofImageUrl').trim() || null,
        status: pbmsPick(dto, 'status', 'Status').trim() || 'Open',
        handledByStaffId: pbmsPickGuid(dto, 'handledByStaffId', 'HandledByStaffId') || null,
      },
      include: this.include(),
    });
    return PbmsResponseDto.ok('Tạo báo cáo sự cố thành công', this.map(item), 201);
  }

  async update(dto: object): Promise<PbmsResponseDto> {
    const id = pbmsPickGuid(dto, 'incidentId', 'IncidentId');
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Dữ liệu cập nhật không hợp lệ');
    }
    const existing = await this.prisma.incidentReport.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy sự cố', 404);
    }
    const item = await this.prisma.incidentReport.update({
      where: { id },
      data: {
        sessionId: pbmsPickGuid(dto, 'sessionId', 'SessionId') || existing.sessionId,
        issueType: pbmsPick(dto, 'issueType', 'IssueType').trim() || existing.issueType,
        description: pbmsPick(dto, 'description', 'Description').trim() || existing.description,
        proofImageUrl: pbmsPick(dto, 'proofImageUrl', 'ProofImageUrl').trim() || existing.proofImageUrl,
        status: pbmsPick(dto, 'status', 'Status').trim() || existing.status,
        handledByStaffId: pbmsPickGuid(dto, 'handledByStaffId', 'HandledByStaffId') || existing.handledByStaffId,
        resolutionNotes: pbmsPick(dto, 'resolutionNotes', 'ResolutionNotes').trim() || existing.resolutionNotes,
      },
      include: this.include(),
    });
    return PbmsResponseDto.ok('Cập nhật sự cố thành công', this.map(item));
  }

  async assign(id: string, staffId: string): Promise<PbmsResponseDto> {
    const existing = await this.prisma.incidentReport.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy sự cố', 404);
    }
    const item = await this.prisma.incidentReport.update({
      where: { id },
      data: { handledByStaffId: staffId, status: 'InProgress' },
      include: this.include(),
    });
    return PbmsResponseDto.ok('Gán nhân viên xử lý thành công', this.map(item));
  }

  async resolve(id: string, staffId: string, dto: object): Promise<PbmsResponseDto> {
    const existing = await this.prisma.incidentReport.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy sự cố', 404);
    }
    const notes = pbmsPick(dto, 'resolutionNotes', 'ResolutionNotes').trim();
    if (!notes) {
      return PbmsResponseDto.fail('Vui lòng nhập ghi chú xử lý');
    }
    const item = await this.prisma.incidentReport.update({
      where: { id },
      data: {
        handledByStaffId: staffId,
        resolutionNotes: notes,
        status: 'Resolved',
        resolvedAt: new Date(),
      },
      include: this.include(),
    });
    return PbmsResponseDto.ok('Đã xử lý sự cố thành công', this.map(item));
  }

  async remove(id: string): Promise<PbmsResponseDto> {
    const existing = await this.prisma.incidentReport.findUnique({ where: { id } });
    if (!existing) {
      return PbmsResponseDto.fail('Không tìm thấy sự cố', 404);
    }
    try {
      await this.prisma.incidentReport.delete({ where: { id } });
      return PbmsResponseDto.ok('Xóa sự cố thành công');
    } catch (error: unknown) {
      return PbmsResponseDto.fail(`Lỗi xóa sự cố: ${errorMessage(error)}`, 500);
    }
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
    };
  }
}
