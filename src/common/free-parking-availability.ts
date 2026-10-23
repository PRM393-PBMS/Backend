import { PrismaService } from '../prisma/prisma.service';
import { isMotorbikeType } from './license-plate';

export async function freeParkingAvailability(
  prisma: PrismaService,
  floorKeyword?: string,
) {
  const floors = await prisma.floor.findMany({
    where: floorKeyword
      ? { floorName: { contains: floorKeyword.trim(), mode: 'insensitive' } }
      : {},
    include: {
      dedicatedVehicleType: true,
      gates: {
        select: {
          _count: {
            select: { entrySessions: { where: { status: 'Active' } } },
          },
        },
      },
    },
  });
  return floors.flatMap((floor) => {
    if (
      !floor.dedicatedVehicleType ||
      !isMotorbikeType(floor.dedicatedVehicleType.typeName)
    ) {
      return [];
    }
    const occupiedSlots = floor.gates.reduce(
      (sum, gate) => sum + gate._count.entrySessions,
      0,
    );
    return [
      {
        parkingId: floor.parkingId,
        floorId: floor.id,
        floorName: floor.floorName,
        vehicleTypeId: floor.dedicatedVehicleType.id,
        vehicleTypeName: floor.dedicatedVehicleType.typeName,
        totalSlots: floor.totalCapacity,
        availableSlots: Math.max(0, floor.totalCapacity - occupiedSlots),
        occupiedSlots,
        assignedSlots: 0,
      },
    ];
  });
}
