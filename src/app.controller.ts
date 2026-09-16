import { Controller, Get, Redirect } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from './auth/common/decorators/public.decorator';

@ApiTags('System')
@Controller()
export class AppController {
  @Public()
  @Get()
  @Redirect('/api/docs', 302)
  @ApiExcludeEndpoint()
  redirectToDocs(): void {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'HTTP liveness check (does not check database readiness)' })
  @ApiOkResponse({ schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } } })
  getHealth(): { status: string } {
    return { status: 'ok' };
  }
}
