import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PbmsResponseDto } from '../common/dto/pbms-response.dto';
import { isEmptyGuid, pbmsPickNumber } from '../common/pbms-fields';
import { FloorLayoutData, LayoutCell, layoutProblems, parseLayout } from './floor-layout';

/** Ô đỗ còn gắn với khách thì không được xoá khỏi sơ đồ. */
const BUSY_SLOT_STATUSES = ['Occupied', 'Assigned'];
const LIVE_SUBSCRIPTION_STATUSES = ['Active', 'PendingPayment'];

class LayoutConflict extends Error {}
class LayoutBlocked extends Error {}

@Injectable()
export class FloorLayoutsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sơ đồ đã xuất bản của mọi tầng trong bãi (app khách). Tầng chưa vẽ không có trong danh sách. */
  async published(parkingId: string): Promise<PbmsResponseDto> {
    if (isEmptyGuid(parkingId)) return PbmsResponseDto.fail('ParkingId không hợp lệ');
    const floors = await this.prisma.floor.findMany({
      where: { parkingId, layout: { not: Prisma.DbNull } },
      select: { id: true, floorName: true, isResident: true, layout: true, layoutPublishedAt: true },
    });
    return PbmsResponseDto.ok(
      'Lấy sơ đồ bãi thành công',
      floors.map((f) => ({
        floorId: f.id,
        floorName: f.floorName,
        isResident: f.isResident,
        publishedAt: f.layoutPublishedAt,
        layout: f.layout,
      })),
    );
  }

  /** Bản đang vẽ của admin: nháp nếu có, không thì bản đã xuất bản. */
  async draft(floorId: string): Promise<PbmsResponseDto> {
    const floor = await this.prisma.floor.findUnique({ where: { id: floorId } });
    if (!floor) return PbmsResponseDto.fail('Không tìm thấy tầng', 404);
    return PbmsResponseDto.ok('Lấy bản vẽ thành công', {
      floorId: floor.id,
      parkingId: floor.parkingId,
      version: floor.layoutVersion,
      publishedAt: floor.layoutPublishedAt,
      hasUnpublished: floor.layoutDraft !== null,
      layout: floor.layoutDraft ?? floor.layout ?? null,
    });
  }

  async saveDraft(floorId: string, dto: object): Promise<PbmsResponseDto> {
    const layout = parseLayout((dto as { layout?: unknown }).layout);
    if (typeof layout === 'string') return PbmsResponseDto.fail(layout);
    const version = pbmsPickNumber(dto, 'version', 'Version');
    if (version === undefined) return PbmsResponseDto.fail('Thiếu version của bản vẽ');
    const moved = await this.prisma.floor.updateMany({
      where: { id: floorId, layoutVersion: version },
      data: { layoutDraft: layout as unknown as Prisma.InputJsonValue, layoutVersion: version + 1 },
    });
    if (moved.count !== 1) return this.versionConflict(floorId);
    return PbmsResponseDto.ok('Đã lưu nháp', { floorId, version: version + 1 });
  }

  /**
   * Xuất bản bản nháp: kiểm tra sơ đồ, đồng bộ ô đỗ và cổng thật theo sơ đồ (sơ đồ là nơi quản lý ô duy nhất),
   * ghi id ô/cổng vào sơ đồ rồi lưu thành bản app khách dùng. Mọi thứ trong một giao dịch.
   */
  async publish(floorId: string, dto: object): Promise<PbmsResponseDto> {
    const version = pbmsPickNumber(dto, 'version', 'Version');
    const floor = await this.prisma.floor.findUnique({ where: { id: floorId } });
    if (!floor) return PbmsResponseDto.fail('Không tìm thấy tầng', 404);
    if (version === undefined || version !== floor.layoutVersion) return this.versionConflict(floorId);
    const layout = parseLayout(floor.layoutDraft ?? floor.layout);
    if (typeof layout === 'string') return PbmsResponseDto.fail(`Bản vẽ chưa hợp lệ: ${layout}`);

    const lotFloors = await this.prisma.floor.findMany({ where: { parkingId: floor.parkingId }, select: { id: true } });
    const problems = layoutProblems(layout, new Set(lotFloors.map((f) => f.id)), floorId);
    const slotCells = layout.cells.filter((c) => c.t === 'slot');
    const typeIds = [...new Set(slotCells.map((c) => c.vehicleTypeId!))];
    const types = await this.prisma.vehicleType.findMany({ where: { id: { in: typeIds } }, select: { id: true } });
    const missingType = typeIds.filter((id) => !types.some((t) => t.id === id));
    if (missingType.length) problems.push('Có ô đỗ chọn loại xe không còn tồn tại');
    // Mã ô là duy nhất trong cả bãi: không trùng ô của tầng khác.
    const otherCodes = await this.prisma.parkingSlot.findMany({
      where: { parkingId: floor.parkingId, floorId: { not: floorId }, slotCode: { in: slotCells.map((c) => c.code!) } },
      select: { slotCode: true },
    });
    for (const s of otherCodes) problems.push(`Mã ô ${s.slotCode} đã có ở tầng khác của bãi`);
    if (problems.length) {
      return new PbmsResponseDto('Sơ đồ chưa xuất bản được', 400, false, { problems });
    }

    try {
      const saved = await this.prisma.$transaction(async (tx) => {
        const cells = await this.syncSlots(tx, floor.parkingId, floorId, layout);
        await this.syncGates(tx, floorId, cells);
        const motoCap = cells.filter((c) => c.t === 'moto').reduce((s, c) => s + (c.cap ?? 0), 0);
        const published: FloorLayoutData = { ...layout, cells };
        const moved = await tx.floor.updateMany({
          where: { id: floorId, layoutVersion: version },
          data: {
            layout: published as unknown as Prisma.InputJsonValue,
            layoutDraft: Prisma.DbNull,
            layoutVersion: version + 1,
            layoutPublishedAt: new Date(),
            totalCapacity: cells.filter((c) => c.t === 'slot').length + motoCap,
          },
        });
        if (moved.count !== 1) throw new LayoutConflict();
        return published;
      });
      return PbmsResponseDto.ok('Đã xuất bản sơ đồ', { floorId, version: version + 1, layout: saved });
    } catch (error: unknown) {
      if (error instanceof LayoutConflict) return this.versionConflict(floorId);
      if (error instanceof LayoutBlocked) {
        return new PbmsResponseDto('Sơ đồ chưa xuất bản được', 400, false, { problems: [error.message] });
      }
      throw error;
    }
  }

  /**
   * Ô đỗ theo sơ đồ: ô có slotId thì cập nhật mã/loại xe, ô mới thì gắn ô cùng mã đang có hoặc tạo mới,
   * ô thật không còn trên sơ đồ thì xoá (chặn nếu đang có xe hoặc giữ cho vé tháng). Trả ô lưới đã gắn slotId.
   */
  private async syncSlots(
    tx: Prisma.TransactionClient,
    parkingId: string,
    floorId: string,
    layout: FloorLayoutData,
  ): Promise<LayoutCell[]> {
    const existing = await tx.parkingSlot.findMany({ where: { floorId } });
    const byId = new Map(existing.map((s) => [s.id, s]));
    const byCode = new Map(existing.map((s) => [s.slotCode.toUpperCase(), s]));
    const used = new Set<string>();
    const cells = layout.cells.map((c) => ({ ...c }));
    for (const c of cells.filter((c) => c.t === 'slot')) {
      const match = (c.slotId && byId.get(c.slotId)) || byCode.get(c.code!);
      if (match && !used.has(match.id)) {
        used.add(match.id);
        c.slotId = match.id;
      } else {
        c.slotId = undefined;
      }
    }
    const removed = existing.filter((s) => !used.has(s.id));
    const busy = removed.filter((s) => BUSY_SLOT_STATUSES.includes(s.status));
    const held = removed.length
      ? await tx.monthlySubscription.findMany({
          where: { fixedSlotId: { in: removed.map((s) => s.id) }, status: { in: LIVE_SUBSCRIPTION_STATUSES } },
          select: { fixedSlotId: true },
        })
      : [];
    const blocked = [...new Set([...busy.map((s) => s.slotCode), ...held.map((h) => byId.get(h.fixedSlotId!)!.slotCode)])];
    if (blocked.length) {
      throw new LayoutBlocked(`Không xoá được ô đang có xe hoặc giữ cho vé tháng: ${blocked.join(', ')}. Giữ các ô này trên sơ đồ.`);
    }
    if (removed.length) await tx.parkingSlot.deleteMany({ where: { id: { in: removed.map((s) => s.id) } } });

    // Đổi mã hai bước (mã tạm trước) để hoán đổi mã giữa hai ô không vướng ràng buộc mã duy nhất.
    const renamed = cells.filter((c) => c.t === 'slot' && c.slotId && byId.get(c.slotId)!.slotCode !== c.code);
    for (const c of renamed) {
      await tx.parkingSlot.update({ where: { id: c.slotId }, data: { slotCode: `~${c.slotId!.slice(0, 13)}` } });
    }
    for (const c of cells.filter((c) => c.t === 'slot')) {
      if (c.slotId) {
        const old = byId.get(c.slotId)!;
        if (old.slotCode !== c.code || old.vehicleTypeId !== c.vehicleTypeId) {
          await tx.parkingSlot.update({
            where: { id: c.slotId },
            data: { slotCode: c.code, vehicleTypeId: c.vehicleTypeId },
          });
        }
      } else {
        const created = await tx.parkingSlot.create({
          data: { parkingId, floorId, slotCode: c.code!, vehicleTypeId: c.vehicleTypeId!, status: 'Available' },
        });
        c.slotId = created.id;
      }
    }
    return cells;
  }

  /** Cổng theo sơ đồ: cập nhật tên/loại hoặc tạo mới. Cổng cũ không còn trên sơ đồ được giữ (còn lịch sử lượt gửi). */
  private async syncGates(tx: Prisma.TransactionClient, floorId: string, cells: LayoutCell[]): Promise<void> {
    const existing = await tx.gate.findMany({ where: { floorId } });
    for (const c of cells.filter((c) => c.t === 'gate')) {
      const match = existing.find((g) => g.id === c.gateId) ?? existing.find((g) => g.gateName === c.name);
      if (match) {
        c.gateId = match.id;
        if (match.gateName !== c.name || match.gateType !== c.gateType) {
          await tx.gate.update({ where: { id: match.id }, data: { gateName: c.name, gateType: c.gateType } });
        }
      } else {
        const created = await tx.gate.create({ data: { floorId, gateName: c.name!, gateType: c.gateType! } });
        c.gateId = created.id;
      }
    }
  }

  private async versionConflict(floorId: string): Promise<PbmsResponseDto> {
    const floor = await this.prisma.floor.findUnique({ where: { id: floorId }, select: { layoutVersion: true } });
    if (!floor) return PbmsResponseDto.fail('Không tìm thấy tầng', 404);
    return new PbmsResponseDto(
      'Bản vẽ vừa được người khác lưu. Tải lại để xem bản mới trước khi sửa tiếp.',
      409,
      false,
      { version: floor.layoutVersion },
    );
  }
}

