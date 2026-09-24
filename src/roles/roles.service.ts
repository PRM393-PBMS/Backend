import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { parseRoleId, pbmsPick, pbmsPickNumber } from '../common/pbms-fields';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<PbmsResponseDto> {
    const roles = await this.prisma.role.findMany({ orderBy: { id: 'asc' } });
    if (roles.length === 0) {
      return PbmsResponseDto.fail('Không tìm thấy quyền nào trong hệ thống', 404);
    }
    return PbmsResponseDto.ok('Lấy danh sách quyền thành công', roles.map((r) => this.map(r)));
  }

  async getById(id: string): Promise<PbmsResponseDto> {
    const roleId = parseRoleId(id);
    if (roleId === null) {
      return PbmsResponseDto.fail('Vui lòng nhập RoleId');
    }
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      return PbmsResponseDto.fail('Không tìm thấy quyền', 404);
    }
    return PbmsResponseDto.ok('Lấy thông tin quyền thành công', this.map(role));
  }

  async create(dto: object): Promise<PbmsResponseDto> {
    const validation = await this.validateName(pbmsPick(dto, 'roleName', 'RoleName'), null);
    if (validation) {
      return validation;
    }
    const roleName = pbmsPick(dto, 'roleName', 'RoleName').trim();
    const description = pbmsPick(dto, 'description', 'Description').trim();
    const max = await this.prisma.role.aggregate({ _max: { id: true } });
    const nextId = (max._max.id ?? 0) + 1;
    try {
      const role = await this.prisma.role.create({
        data: { id: nextId, roleName, description: description || '' },
      });
      return PbmsResponseDto.ok('Tạo quyền thành công', this.map(role), 201);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return PbmsResponseDto.fail('Tên quyền đã tồn tại hoặc dữ liệu không hợp lệ');
      }
      const message = error instanceof Error ? error.message : 'unknown';
      return PbmsResponseDto.fail(`Lỗi tạo quyền: ${message}`, 500);
    }
  }

  async update(dto: object): Promise<PbmsResponseDto> {
    const roleId = pbmsPickNumber(dto, 'roleId', 'RoleId') ?? parseRoleId(pbmsPick(dto, 'roleId', 'RoleId'));
    if (roleId === null || roleId === undefined) {
      return PbmsResponseDto.fail('Dữ liệu cập nhật quyền không hợp lệ');
    }
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      return PbmsResponseDto.fail('Không tìm thấy quyền', 404);
    }
    if (role.roleName.toLowerCase() === 'admin') {
      return PbmsResponseDto.fail('Không thể chỉnh sửa quyền admin');
    }
    const validation = await this.validateName(pbmsPick(dto, 'roleName', 'RoleName'), roleId);
    if (validation) {
      return validation;
    }
    try {
      const updated = await this.prisma.role.update({
        where: { id: roleId },
        data: {
          roleName: pbmsPick(dto, 'roleName', 'RoleName').trim(),
          description: pbmsPick(dto, 'description', 'Description').trim() || '',
        },
      });
      return PbmsResponseDto.ok('Cập nhật quyền thành công', this.map(updated));
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return PbmsResponseDto.fail('Tên quyền đã tồn tại hoặc dữ liệu không hợp lệ');
      }
      const message = error instanceof Error ? error.message : 'unknown';
      return PbmsResponseDto.fail(`Lỗi cập nhật quyền: ${message}`, 500);
    }
  }

  async remove(id: string): Promise<PbmsResponseDto> {
    const roleId = parseRoleId(id);
    if (roleId === null) {
      return PbmsResponseDto.fail('Vui lòng nhập RoleId');
    }
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      return PbmsResponseDto.fail('Không tìm thấy quyền', 404);
    }
    if (role.roleName.toLowerCase() === 'admin' || roleId === 4) {
      return PbmsResponseDto.fail('Không thể xóa quyền admin');
    }
    const users = await this.prisma.user.count({ where: { roleId } });
    if (users > 0) {
      return PbmsResponseDto.fail('Không thể xóa quyền đang được gán cho người dùng');
    }
    await this.prisma.role.delete({ where: { id: roleId } });
    return PbmsResponseDto.ok('Xóa quyền thành công');
  }

  private map(role: { id: number; roleName: string; description: string | null }) {
    return {
      roleId: role.id,
      roleName: role.roleName,
      description: role.description ?? '',
    };
  }

  private async validateName(roleName: string, currentId: number | null): Promise<PbmsResponseDto | null> {
    const trimmed = roleName.trim();
    if (!trimmed) {
      return PbmsResponseDto.fail('Vui lòng nhập tên quyền');
    }
    if (trimmed.toLowerCase() === 'admin') {
      return PbmsResponseDto.fail('Không được tạo hoặc đổi tên quyền admin');
    }
    if (trimmed.length > 50) {
      return PbmsResponseDto.fail('Tên quyền không được vượt quá 50 ký tự');
    }
    const dup = await this.prisma.role.findFirst({
      where: {
        roleName: { equals: trimmed, mode: 'insensitive' },
        ...(currentId !== null ? { NOT: { id: currentId } } : {}),
      },
    });
    if (dup) {
      return PbmsResponseDto.fail('Tên quyền đã tồn tại');
    }
    return null;
  }
}
