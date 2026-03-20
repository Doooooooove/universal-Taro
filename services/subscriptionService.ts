import { supabase } from './supabaseClient';
import { getCurrentUser } from './authService';

/**
 * 订阅服务 - 爱发电支付集成
 */

export interface SubscriptionStatus {
  plan_type: string;
  afdian_plan_id?: string;
  expires_at?: string;
  last_order_no?: string;
}

// 创建订阅意向并获取支付链接
export const createSubscriptionIntent = async (
  planType: 'plus' | 'pro'
): Promise<{ success: boolean; payUrl?: string; error?: string }> => {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: '请先登录' };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) {
    return { success: false, error: '会话已过期，请重新登录' };
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/create-intent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': supabaseAnonKey,
        },
        body: JSON.stringify({ planType }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return { success: false, error: result.error || '创建订阅失败' };
    }

    return {
      success: true,
      payUrl: result.payUrl,
    };
  } catch (error) {
    console.error('Create intent error:', error);
    return { success: false, error: '网络请求失败' };
  }
};

// 验证订阅状态（用户点击"我已付款"后调用）
export const verifySubscription = async (): Promise<{
  matched: boolean;
  subscription: SubscriptionStatus;
  error?: string;
}> => {
  const user = await getCurrentUser();
  if (!user) {
    return { matched: false, subscription: { plan_type: 'free' }, error: '请先登录' };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) {
    return { matched: false, subscription: { plan_type: 'free' }, error: '会话已过期' };
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/afdian-verify`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': supabaseAnonKey,
        },
        body: JSON.stringify({}),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return { matched: false, subscription: { plan_type: 'free' }, error: result.error };
    }

    return {
      matched: result.matched,
      subscription: result.subscription || { plan_type: 'free' },
    };
  } catch (error) {
    console.error('Verify subscription error:', error);
    return { matched: false, subscription: { plan_type: 'free' }, error: '网络请求失败' };
  }
};

// 获取当前订阅状态（从 Supabase 直接查询）
export const getSubscriptionStatus = async (): Promise<SubscriptionStatus> => {
  const user = await getCurrentUser();
  if (!user) {
    return { plan_type: 'free' };
  }

  try {
    const { data, error } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (error || !data) {
      return { plan_type: 'free' };
    }

    // 检查是否过期
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return { plan_type: 'free' };
    }

    return data;
  } catch {
    return { plan_type: 'free' };
  }
};
