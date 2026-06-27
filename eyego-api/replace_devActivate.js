const fs = require('fs');

let content = fs.readFileSync('src/modules/drivers/drivers.service.js', 'utf8');

const newFunc = `async function devActivate(driverId) {
  // Guard: dev-only endpoint
  if (env.NODE_ENV !== 'development') {
    throw new ForbiddenError('This endpoint is only available in development');
  }

  const minBalance = env.DRIVER_REQUIRED_WALLET_TO_GO_ONLINE ?? 20;
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { id: true, walletBalance: true },
  });
  if (!driver) throw new NotFoundError('Driver');

  const currentBalance = driver.walletBalance ?? 0;
  const topUp = currentBalance < minBalance ? minBalance - currentBalance : 0;

  // Atomically update status + wallet, and record the transaction
  return prisma.$transaction(async (tx) => {
    const updated = await tx.driver.update({
      where: { id: driverId },
      data: {
        status: 'ACTIVE',
        ...(topUp > 0 && { walletBalance: { increment: topUp } }),
      },
    });

    if (topUp > 0) {
      await tx.walletTransaction.create({
        data: {
          driverId,
          type: 'TOP_UP',
          amount: topUp,
          description: 'Dev-activate wallet top-up',
          balanceBefore: currentBalance,
          balanceAfter: currentBalance + topUp,
        },
      });
    }

    return updated;
  });
}
`;

const oldStart = content.indexOf('async function devActivate(driverId) {');
const oldEnd = content.indexOf('async function getTripHistory', oldStart);

if (oldStart === -1 || oldEnd === -1) {
  console.log("ERROR: could not find function boundaries");
  process.exit(1);
}

const oldFunc = content.slice(oldStart, oldEnd);
content = content.replace(oldFunc, newFunc);
fs.writeFileSync('src/modules/drivers/drivers.service.js', content);
console.log("Replaced devActivate function successfully");
console.log("Old length: " + oldFunc.length + " New: " + newFunc.length);
