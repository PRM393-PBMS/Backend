import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileController } from './profile.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AccountDeletionController } from './account-deletion.controller';
import { HardDeleteAccountService } from './hard-delete-account.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController, ProfileController, AccountDeletionController],
  providers: [UsersService, HardDeleteAccountService],
  exports: [UsersService],
})
export class UsersModule {}
