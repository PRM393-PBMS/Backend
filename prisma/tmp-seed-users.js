const { PrismaClient, UserRole } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();
const password = process.env.SEED_PASSWORD;

const accounts = [
  {
    email: 'admin@gmail.com',
    userName: 'admin',
    fullName: 'Admin',
    roleId: 4,
    role: UserRole.ADMIN,
  },
  {
    email: 'manager@gmail.com',
    userName: 'manager',
    fullName: 'Manager',
    roleId: 3,
    role: UserRole.MODERATOR,
  },
  {
    email: 'staff1@gmail.com',
    userName: 'staff1',
    fullName: 'Staff 1',
    roleId: 2,
    role: UserRole.MODERATOR,
  },
  {
    email: 'staff2@gmail.com',
    userName: 'staff2',
    fullName: 'Staff 2',
    roleId: 2,
    role: UserRole.MODERATOR,
  },
];

async function main() {
  if (!password) {
    throw new Error('MISSING_PASSWORD');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  for (const account of accounts) {
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: {
        passwordHash,
        userName: account.userName,
        fullName: account.fullName,
        roleId: account.roleId,
        role: account.role,
        status: 'Active',
        isActive: true,
        isEmailVerified: true,
      },
      create: {
        email: account.email,
        passwordHash,
        userName: account.userName,
        fullName: account.fullName,
        roleId: account.roleId,
        role: account.role,
        status: 'Active',
        isActive: true,
        isEmailVerified: true,
      },
    });
    await prisma.wallet.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, balance: 0 },
    });
    console.log(`${account.email} roleId=${account.roleId}`);
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
