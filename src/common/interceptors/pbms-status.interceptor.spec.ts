import { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { PbmsResponseDto } from '../dto/pbms-response.dto';
import { PbmsStatusInterceptor } from './pbms-status.interceptor';

describe('PbmsStatusInterceptor', () => {
  it('sets HTTP status from ResponseDTO.statusCode', async () => {
    const interceptor = new PbmsStatusInterceptor();
    const status = jest.fn();
    const context = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    } as unknown as ExecutionContext;
    const body = new PbmsResponseDto('Tài khoản của bạn đã bị khóa', 403, false);

    await lastValueFrom(
      interceptor.intercept(context, {
        handle: () => of(body),
      }),
    );

    expect(status).toHaveBeenCalledWith(403);
  });
});
