import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HashingService } from '../auth/services/hashing.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { isEmptyGuid, pbmsPick, pbmsPickGuid, pbmsPickNumber } from '../common/pbms-fields';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
  ) {}

  async getAll(): Promise<PbmsResponseDto> {
    const users = await this.prisma.user.findMany({
      include: { pbmsRole: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    if (users.length === 0) {
      return PbmsResponseDto.fail('Không tìm thấy người dùng nào trong hệ thống', 404);
    }
    return PbmsResponseDto.ok('Lấy danh sách người dùng thành công', users.map((u) => this.mapUser(u)));
  }

  async getById(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập UserId');
    }
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { pbmsRole: true },
    });
    if (!user) {
      return PbmsResponseDto.fail('Không tìm thấy người dùng', 404);
    }
    return PbmsResponseDto.ok('Tìm thấy người dùng thành công', this.mapUser(user));
  }

  async getProfile(userId: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(userId)) {
      return PbmsResponseDto.fail('Vui lòng đăng nhập', 401);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { pbmsRole: true },
    });
    if (!user) {
      return PbmsResponseDto.fail('Không tìm thấy người dùng', 404);
    }
    return PbmsResponseDto.ok('Lấy thông tin cá nhân thành công', this.mapUser(user));
  }

  async updateProfile(userId: string, dto: object): Promise<PbmsResponseDto> {
    if (isEmptyGuid(userId)) {
      return PbmsResponseDto.fail('Vui lòng đăng nhập', 401);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { pbmsRole: true },
    });
    if (!user) {
      return PbmsResponseDto.fail('Không tìm thấy người dùng', 404);
    }

    const emailRaw = pbmsPick(dto, 'email', 'Email').trim();
    const fullName = pbmsPick(dto, 'fullName', 'FullName').trim();
    const phoneNumber = pbmsPick(dto, 'phoneNumber', 'PhoneNumber').trim() || null;
    const password = pbmsPick(dto, 'password', 'Password');

    const data: Prisma.UserUpdateInput = {};
    if (emailRaw) {
      if (!EMAIL_RE.test(emailRaw)) {
        return PbmsResponseDto.fail('Email sai định dạng');
      }
      const dup = await this.prisma.user.findFirst({
        where: { email: { equals: emailRaw, mode: 'insensitive' }, NOT: { id: userId } },
      });
      if (dup) {
        return PbmsResponseDto.fail('Email đã được sử dụng');
      }
      data.email = emailRaw;
    }
    if (fullName) {
      data.fullName = fullName;
    }
    if (phoneNumber) {
      const dupPhone = await this.prisma.user.findFirst({
        where: { phoneNumber, NOT: { id: userId } },
      });
      if (dupPhone) {
        return PbmsResponseDto.fail('Số điện thoại đã được sử dụng');
      }
      data.phoneNumber = phoneNumber;
    }
    if (password) {
      data.passwordHash = await this.hashing.hash(password);
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data,
        include: { pbmsRole: true },
      });
      return PbmsResponseDto.ok('Cập nhật thông tin cá nhân thành công', this.mapUser(updated));
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return PbmsResponseDto.fail('Dữ liệu thông tin cá nhân bị trùng hoặc không hợp lệ');
      }
      const message = error instanceof Error ? error.message : 'unknown';
      return PbmsResponseDto.fail(`Lỗi cập nhật thông tin cá nhân: ${message}`, 500);
    }
  }

  async getManageableRoles(): Promise<PbmsResponseDto> {
    const roles = await this.prisma.role.findMany({
      where: { NOT: { roleName: { equals: 'Admin', mode: 'insensitive' } } },
      orderBy: { roleName: 'asc' },
    });
    if (roles.length === 0) {
      return PbmsResponseDto.fail('Không tìm thấy quyền có thể gán trong hệ thống', 404);
    }
    return PbmsResponseDto.ok(
      'Lấy danh sách quyền có thể gán thành công',
      roles.map((r) => ({
        roleId: r.id,
        roleName: r.roleName,
        description: r.description ?? '',
      })),
    );
  }

  async create(dto: object): Promise<PbmsResponseDto> {
    const userName = pbmsPick(dto, 'userName', 'UserName').trim();
    const email = pbmsPick(dto, 'email', 'Email').trim();
    const password = pbmsPick(dto, 'password', 'Password');
    const fieldErr = this.validateUserFields(userName, email);
    if (fieldErr) {
      return fieldErr;
    }
    if (!password) {
      return PbmsResponseDto.fail('Vui lòng nhập mật khẩu');
    }
    const roleRes = await this.resolveAssignableRole(
      pbmsPickNumber(dto, 'roleId', 'RoleId'),
      pbmsPick(dto, 'roleName', 'RoleName'),
    );
    if (roleRes.error) {
      return roleRes.error;
    }
    const phoneNumber = pbmsPick(dto, 'phoneNumber', 'PhoneNumber').trim() || null;
    const dup = await this.validateDuplicates(userName, email, phoneNumber, null);
    if (dup) {
      return dup;
    }
    const fullName = pbmsPick(dto, 'fullName', 'FullName').trim() || 'Chưa đặt tên';
    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash: await this.hashing.hash(password),
          userName,
          fullName,
          phoneNumber,
          status: 'Active',
          isActive: true,
          roleId: roleRes.role!.id,
          role: this.nestRole(roleRes.role!.roleName),
        },
        include: { pbmsRole: true },
      });
      return PbmsResponseDto.ok('Tạo người dùng thành công', this.mapUser(user), 201);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return PbmsResponseDto.fail(
          'Dữ liệu người dùng bị trùng hoặc không hợp lệ, vui lòng kiểm tra lại',
        );
      }
      const message = error instanceof Error ? error.message : 'unknown';
      return PbmsResponseDto.fail(`Lỗi tạo người dùng: ${message}`, 500);
    }
  }

  async update(dto: object): Promise<PbmsResponseDto> {
    const userId = pbmsPickGuid(dto, 'userId', 'UserId');
    if (isEmptyGuid(userId)) {
      return PbmsResponseDto.fail('Vui lòng nhập UserId');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { pbmsRole: true },
    });
    if (!user) {
      return PbmsResponseDto.fail('Không tìm thấy người dùng', 404);
    }
    if (this.isAdmin(user.pbmsRole?.roleName)) {
      return PbmsResponseDto.fail('Không thể chỉnh sửa tài khoản admin');
    }
    const userName = pbmsPick(dto, 'userName', 'UserName').trim();
    const email = pbmsPick(dto, 'email', 'Email').trim();
    const fieldErr = this.validateUserFields(userName, email);
    if (fieldErr) {
      return fieldErr;
    }
    const roleRes = await this.resolveAssignableRole(
      pbmsPickNumber(dto, 'roleId', 'RoleId'),
      pbmsPick(dto, 'roleName', 'RoleName'),
    );
    if (roleRes.error) {
      return roleRes.error;
    }
    const phoneNumber = pbmsPick(dto, 'phoneNumber', 'PhoneNumber').trim() || null;
    const dup = await this.validateDuplicates(userName, email, phoneNumber, userId);
    if (dup) {
      return dup;
    }
    const password = pbmsPick(dto, 'password', 'Password');
    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: {
          userName,
          email,
          fullName: pbmsPick(dto, 'fullName', 'FullName').trim() || 'Chưa đặt tên',
          phoneNumber,
          roleId: roleRes.role!.id,
          role: this.nestRole(roleRes.role!.roleName),
          ...(password ? { passwordHash: await this.hashing.hash(password) } : {}),
        },
        include: { pbmsRole: true },
      });
      return PbmsResponseDto.ok('Cập nhật người dùng thành công', this.mapUser(updated));
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return PbmsResponseDto.fail(
          'Dữ liệu người dùng bị trùng hoặc không hợp lệ, vui lòng kiểm tra lại',
        );
      }
      const message = error instanceof Error ? error.message : 'unknown';
      return PbmsResponseDto.fail(`Lỗi cập nhật người dùng: ${message}`, 500);
    }
  }

  async updateStatus(id: string, dto: object): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập UserId');
    }
    const statusRaw = pbmsPick(dto, 'status', 'Status').trim();
    if (!statusRaw) {
      return PbmsResponseDto.fail('Vui lòng nhập trạng thái người dùng');
    }
    const normalized = this.normalizeUserStatus(statusRaw);
    if (!normalized) {
      return PbmsResponseDto.fail('Trạng thái chỉ được là Active, Inactive hoặc Banned');
    }
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { pbmsRole: true },
    });
    if (!user) {
      return PbmsResponseDto.fail('Không tìm thấy người dùng', 404);
    }
    if (this.isAdmin(user.pbmsRole?.roleName)) {
      return PbmsResponseDto.fail('Không thể thay đổi trạng thái tài khoản admin');
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: normalized, isActive: normalized === 'Active' },
      include: { pbmsRole: true },
    });
    return PbmsResponseDto.ok('Cập nhật trạng thái người dùng thành công', this.mapUser(updated));
  }

  async remove(id: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(id)) {
      return PbmsResponseDto.fail('Vui lòng nhập UserId');
    }
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { pbmsRole: true },
    });
    if (!user) {
      return PbmsResponseDto.fail('Không tìm thấy người dùng', 404);
    }
    if (this.isAdmin(user.pbmsRole?.roleName)) {
      return PbmsResponseDto.fail('Không thể xóa tài khoản admin');
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: 'Inactive', isActive: false },
      include: { pbmsRole: true },
    });
    return PbmsResponseDto.ok('Xóa người dùng thành công', this.mapUser(updated));
  }

  private mapUser(user: {
    id: string;
    userName: string | null;
    email: string;
    fullName: string | null;
    phoneNumber: string | null;
    status: string | null;
    roleId: number;
    pbmsRole: { roleName: string } | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      userId: user.id,
      userName: user.userName ?? '',
      email: user.email,
      fullName: user.fullName ?? '',
      phoneNumber: user.phoneNumber,
      status: user.status ?? 'Active',
      roleId: user.roleId,
      roleName: user.pbmsRole?.roleName ?? 'Chưa phân quyền',
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private validateUserFields(userName: string, email: string): PbmsResponseDto | null {
    if (!userName) {
      return PbmsResponseDto.fail('Vui lòng nhập UserName');
    }
    if (!email) {
      return PbmsResponseDto.fail('Vui lòng nhập Email');
    }
    if (!EMAIL_RE.test(email)) {
      return PbmsResponseDto.fail('Email sai định dạng');
    }
    return null;
  }

  private async resolveAssignableRole(roleId: number | undefined, roleName: string) {
    if ((roleId === undefined || roleId === null) && !roleName.trim()) {
      return { role: null, error: PbmsResponseDto.fail('Vui lòng chọn quyền cho người dùng') };
    }
    const role =
      roleId !== undefined && roleId !== null
        ? await this.prisma.role.findUnique({ where: { id: roleId } })
        : await this.prisma.role.findFirst({
            where: { roleName: { equals: roleName.trim(), mode: 'insensitive' } },
          });
    if (!role) {
      return { role: null, error: PbmsResponseDto.fail('Quyền người dùng không tồn tại', 404) };
    }
    if (this.isAdmin(role.roleName)) {
      return { role: null, error: PbmsResponseDto.fail('Không được tạo hoặc gán quyền admin') };
    }
    return { role, error: null };
  }

  private async validateDuplicates(
    userName: string,
    email: string,
    phoneNumber: string | null,
    currentId: string | null,
  ): Promise<PbmsResponseDto | null> {
    const notCurrent = currentId ? { NOT: { id: currentId } } : {};
    if (await this.prisma.user.findFirst({ where: { userName, ...notCurrent } })) {
      return PbmsResponseDto.fail('UserName đã tồn tại');
    }
    if (
      await this.prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, ...notCurrent },
      })
    ) {
      return PbmsResponseDto.fail('Email đã được sử dụng');
    }
    if (
      phoneNumber &&
      (await this.prisma.user.findFirst({ where: { phoneNumber, ...notCurrent } }))
    ) {
      return PbmsResponseDto.fail('Số điện thoại đã được sử dụng');
    }
    return null;
  }

  private isAdmin(roleName: string | null | undefined): boolean {
    return (roleName ?? '').toLowerCase() === 'admin';
  }

  private nestRole(roleName: string): UserRole {
    const n = roleName.toLowerCase();
    if (n === 'admin') {
      return UserRole.ADMIN;
    }
    if (n === 'manager' || n === 'staff') {
      return UserRole.MODERATOR;
    }
    return UserRole.USER;
  }

  private normalizeUserStatus(value: string): string | null {
    const map: Record<string, string> = {
      active: 'Active',
      inactive: 'Inactive',
      banned: 'Banned',
    };
    return map[value.trim().toLowerCase()] ?? null;
  }
}
