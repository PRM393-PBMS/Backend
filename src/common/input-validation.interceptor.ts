import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { isUUID, isISO8601 } from 'class-validator';
import { AppError } from './errors';
import { inputFieldName } from './user-message';
import { PbmsResponseDto } from './dto/pbms-response.dto';
import { tap } from 'rxjs';
import { validateFormText } from './form-validation';
import { isValidLicensePlate, PLATE_FORMAT_MESSAGE } from './license-plate';

const numeric =
  /^(amount|price|basePrice|extraHourPrice|nightSurcharge|baseHours|durationDays|durationMonths|totalCapacity|months|latitude|longitude|page|limit)$/i;
const boolean =
  /^(isResident|requireFixedSlot|allParkings|autoRenew|agreed|isActive)$/i;
@Injectable()
export class InputValidationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const { body, params, query, path } = context.switchToHttp().getRequest();
    if (path !== '/api/payments/payos-webhook') {
      for (const values of [body, params, query]) {
        if (!values || typeof values !== 'object' || Array.isArray(values)) {
          if (Array.isArray(values))
            throw new AppError(
              400,
              'INVALID_BODY',
              'Dữ liệu phải là một đối tượng',
            );
          continue;
        }
        for (const [key, value] of Object.entries(values)) {
          if (values === body && value !== undefined) {
            const textError = validateFormText(key, value);
            if (textError) throw new AppError(400, 'INVALID_FIELD', textError);
            if (
              /^(licensePlate|licensePlateIn|licensePlateOut|newLicensePlate)$/i.test(
                key,
              ) &&
              value !== null &&
              value !== '' &&
              (typeof value !== 'string' || !isValidLicensePlate(value))
            ) {
              throw new AppError(
                400,
                'INVALID_LICENSE_PLATE',
                PLATE_FORMAT_MESSAGE,
              );
            }
          }
          if (value === undefined || value === null || value === '') continue;
          const lengths: Record<string, number> = {
            typename: 50,
            dimensions: 50,
            floorname: 50,
            gatename: 50,
            slotcode: 15,
            packagename: 100,
            licenseplate: 15,
            licenseplatein: 15,
            licenseplateout: 15,
            newlicenseplate: 15,
            description: 500,
            reason: 500,
            signername: 100,
            name: 255,
            location: 500,
            nickname: 40,
            modelname: 60,
          };
          const max = lengths[key.toLowerCase()];
          if (max && (typeof value !== 'string' || value.length > max))
            throw new AppError(
              400,
              'INVALID_TEXT',
              `${inputFieldName(key)} phải là chuỗi tối đa ${max} ký tự`,
            );
          if (/^status$/i.test(key)) {
            const states = /parkingSlot/i.test(path)
              ? ['Available', 'Occupied', 'Assigned', 'Maintenance', 'Locked']
              : /MonthlySubscription/i.test(path)
                ? ['PendingPayment', 'Active', 'Cancelled', 'Expired']
                : /SubscriptionPackage/i.test(path)
                  ? ['Active', 'Inactive', 'Suspended']
                  : /PricingPolicy/i.test(path)
                    ? ['Active', 'Inactive']
                    : /Reservation/i.test(path)
                      ? [
                          'Pending',
                          'Confirmed',
                          'Modified',
                          'CheckedIn',
                          'Completed',
                          'Cancelled',
                          'NoShow',
                        ]
                      : /Incident/i.test(path)
                        ? ['Open', 'InProgress', 'Resolved', 'Cancelled']
                        : /User|profile/i.test(path)
                          ? ['Active', 'Inactive', 'Banned']
                          : null;
            if (states && typeof value === 'string')
              values[key] =
                states.find((s) => s.toLowerCase() === value.toLowerCase()) ??
                value;
            if (
              states &&
              (typeof value !== 'string' ||
                !states.some((s) => s.toLowerCase() === value.toLowerCase()))
            )
              throw new AppError(
                400,
                'INVALID_STATUS',
                'Trạng thái không hợp lệ',
              );
          }
          if (
            /^(id|.*Id)$/i.test(key) &&
            !/^orderCode$/i.test(key) &&
            (typeof value !== 'string' ||
              !isUUID(value) ||
              /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value))
          )
            throw new AppError(
              400,
              'INVALID_UUID',
              `${inputFieldName(key)} không hợp lệ. Vui lòng chọn lại`,
            );
          if (numeric.test(key)) {
            const n =
              typeof value === 'number' || typeof value === 'string'
                ? Number(value)
                : NaN;
            if (
              !Number.isFinite(n) ||
              (!/^(latitude|longitude)$/i.test(key) &&
                (n < 0 || n > 1_000_000_000 || !Number.isInteger(n))) ||
              (/^(baseHours|durationDays|durationMonths|totalCapacity|months|page|limit)$/i.test(
                key,
              ) &&
                n < 1)
            )
              throw new AppError(
                400,
                'INVALID_NUMBER',
                `${inputFieldName(key)} có giá trị không hợp lệ`,
              );
          }
          if (boolean.test(key) && typeof value !== 'boolean')
            throw new AppError(
              400,
              'INVALID_BOOLEAN',
              `${inputFieldName(key)} cần được chọn hoặc bỏ chọn`,
            );
          if (
            /(Time|Date|At)$/.test(key) &&
            (typeof value !== 'string' ||
              !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
              !isISO8601(value, { strict: true, strictSeparator: true }))
          )
            throw new AppError(
              400,
              'INVALID_DATE',
              `${inputFieldName(key)} chưa đúng định dạng. Vui lòng chọn lại ngày và giờ`,
            );
          if (
            typeof value === 'string' &&
            !/signatureImage/i.test(key) &&
            value.length > 4096
          )
            throw new AppError(
              400,
              'VALUE_TOO_LONG',
              `${inputFieldName(key)} vượt quá độ dài cho phép`,
            );
          const alternate = key[0].toUpperCase() + key.slice(1);
          if (
            alternate !== key &&
            values[alternate] !== undefined &&
            JSON.stringify(value) !== JSON.stringify(values[alternate])
          )
            throw new AppError(
              400,
              'AMBIGUOUS_FIELD',
              `Thông tin được gửi không thống nhất. Vui lòng tải lại và thử lại`,
            );
        }
      }
    }
    return next.handle().pipe(
      tap((result) => {
        if (result instanceof PbmsResponseDto)
          context.switchToHttp().getResponse().status(result.statusCode);
      }),
    );
  }
}
