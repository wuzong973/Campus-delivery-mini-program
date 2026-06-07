const {
  PLATFORM_FEE_RATE,
  now,
  roundMoney,
  formatCurrency,
  createNotification,
  getCurrentUser,
  User,
} = require("./shared");
const { Withdrawal } = require("../models");

async function getWalletData(openid) {
  const user = await getCurrentUser(openid);
  if (!user) {
    throw new Error("用户不存在，请重新登录");
  }

  const withdrawals = await Withdrawal.find({ userOpenId: openid })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  const pendingAmount = withdrawals
    .filter((item) => item.status === "pending")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const cumulativeIncome = roundMoney(user.totalIncome);
  const cumulativeWithdrawn = roundMoney(user.totalWithdrawn);
  const pendingWithdrawAmount = roundMoney(pendingAmount);
  const derivedBalance = roundMoney(
    Math.max(cumulativeIncome - cumulativeWithdrawn - pendingWithdrawAmount, 0),
  );
  const balance = roundMoney(user.walletBalance);
  const finalBalance = Math.max(balance, derivedBalance);

  return {
    balance: finalBalance,
    balanceText: formatCurrency(finalBalance),
    totalIncome: cumulativeIncome,
    totalIncomeText: formatCurrency(cumulativeIncome),
    totalWithdrawn: cumulativeWithdrawn,
    totalWithdrawnText: formatCurrency(cumulativeWithdrawn),
    pendingWithdrawAmount,
    pendingWithdrawText: formatCurrency(pendingWithdrawAmount),
    takeLimitTip: `平台抽成 ${(PLATFORM_FEE_RATE * 100).toFixed(0)}%，跑腿员收益结算到余额后可发起提现。`,
    withdrawals: withdrawals.map((withdrawal) => ({
      id: withdrawal._id,
      amount: roundMoney(withdrawal.amount),
      amountText: formatCurrency(withdrawal.amount),
      status: withdrawal.status,
      createdAt: withdrawal.createdAt,
      createdAtText: new Date(withdrawal.createdAt).toLocaleString("zh-CN"),
      remark: withdrawal.remark || "",
    })),
  };
}

async function createWithdrawal(openid, amount) {
  const money = roundMoney(amount);
  if (!money || money <= 0) {
    throw new Error("请输入正确的提现金额");
  }
  const user = await getCurrentUser(openid);
  if (!user) {
    throw new Error("用户不存在");
  }

  const withdrawals = await Withdrawal.find({ userOpenId: openid, status: "pending" }).lean();
  const pendingAmount = withdrawals.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const availableBalance = roundMoney(
    Math.max(Number(user.totalIncome || 0) - Number(user.totalWithdrawn || 0) - pendingAmount, 0),
  );

  if (money > availableBalance) {
    throw new Error("可提现余额不足");
  }

  const created = await Withdrawal.create({
    userOpenId: openid,
    amount: money,
    status: "pending",
    remark: "待管理员审核后发起提现",
    createdAt: now(),
    updatedAt: now(),
  });

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        walletBalance: roundMoney(Math.max(Number(user.totalIncome || 0) - Number(user.totalWithdrawn || 0) - (pendingAmount + money), 0)),
        updatedAt: now(),
      },
    },
  );

  await createNotification(
    openid,
    "提现申请已提交",
    "提现申请已进入审核队列，请留意后续处理结果。",
    "withdrawal",
    "",
  );

  return {
    withdrawalId: created._id,
    amount: money,
    availableBalance: roundMoney(Math.max(availableBalance - money, 0)),
  };
}

module.exports = {
  getWalletData,
  createWithdrawal,
};
