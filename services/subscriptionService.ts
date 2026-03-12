import { supabase } from './supabaseClient';
import { getCurrentUser } from './authService';

/**
 * 订阅服务 - 管理用户订阅状态和每日用量
 */

export type PlanType = 'free' | 'plus' | 'pro';

export interface SubscriptionInfo {
  plan: PlanType;
  expiresAt: string | null;
  dailyUsed: number;
  dailyLimit: number;
}

export interface SubscriptionRecord {
  plan: string;
  status: string;
  expires_at: string;
}

// 获取当前订阅状态（含每日用量）
export const getSubscription = async (): Promise<SubscriptionInfo> => {
  const user = await getCurrentUser();
  if (!user) {
    return { plan: 'free', expiresAt: null, dailyUsed: 0, dailyLimit: 1 };
  }

  // 并行查询订阅和每日用量
  const [subResult, usageResult] = await Promise.all([
    supabase.rpc('get_user_subscription', { p_user_id: user.id }),
    supabase.rpc('get_daily_usage_info', { p_user_id: user.id }),
  ]);

  let plan: PlanType = 'free';
  let expiresAt: string | null = null;

  if (subResult.data && subResult.data.length > 0) {
    plan = subResult.data[0].plan as PlanType;
    expiresAt = subResult.data[0].expires_at;
  }

  let dailyUsed = 0;
  let dailyLimit = 1;

  if (usageResult.data && usageResult.data.length > 0) {
    dailyUsed = usageResult.data[0].daily_used;
    dailyLimit = usageResult.data[0].daily_limit;
  }

  return { plan, expiresAt, dailyUsed, dailyLimit };
};

// 检查是否可以占卜
export const canPerformReading = async (): Promise<{
  allowed: boolean;
  reason?: string;
  plan: PlanType;
  dailyUsed: number;
  dailyLimit: number;
}> => {
  const sub = await getSubscription();

  if (sub.plan === 'pro') {
    return { allowed: true, plan: sub.plan, dailyUsed: sub.dailyUsed, dailyLimit: sub.dailyLimit };
  }

  if (sub.dailyUsed >= sub.dailyLimit) {
    return {
      allowed: false,
      reason: sub.plan === 'free'
        ? '今日免费次数已用完，升级订阅获取更多次数'
        : '今日次数已用完，升级到 Pro 获取无限次数',
      plan: sub.plan,
      dailyUsed: sub.dailyUsed,
      dailyLimit: sub.dailyLimit,
    };
  }

  return { allowed: true, plan: sub.plan, dailyUsed: sub.dailyUsed, dailyLimit: sub.dailyLimit };
};

// 获取订阅显示名称
export const getPlanDisplayName = (plan: PlanType, lang: 'zh' | 'en' = 'zh'): string => {
  const names = {
    free: { zh: '免费版', en: 'Free' },
    plus: { zh: 'Plus', en: 'Plus' },
    pro: { zh: 'Pro', en: 'Pro' },
  };
  return names[plan]?.[lang] || plan;
};

// 获取订阅徽章颜色 class
export const getPlanBadgeClass = (plan: PlanType): string => {
  switch (plan) {
    case 'pro':
      return 'bg-gradient-to-r from-purple-500 to-pink-500 text-white';
    case 'plus':
      return 'bg-gradient-to-r from-primary to-[#eab308] text-[#1a0b2e]';
    default:
      return 'bg-white/10 text-white/60';
  }
};
