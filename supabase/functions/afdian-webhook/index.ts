import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 爱发电配置
const AFDIAN_TOKEN = Deno.env.get("AFDIAN_TOKEN") || "";

// plan_id → 订阅等级映射（部署后从第一次 webhook 测试中获取实际 plan_id）
// TODO: 替换为实际的爱发电 plan_id
const PLAN_MAP: Record<string, string> = {
  // "爱发电的plus方案plan_id": "plus",
  // "爱发电的pro方案plan_id": "pro",
};

// 价格兜底映射：如果 plan_id 未配置，按金额判断
function getPlanByAmount(amount: string): string | null {
  const num = parseFloat(amount);
  if (num >= 29) return "pro";
  if (num >= 12) return "plus";
  return null;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("Received afdian webhook:", JSON.stringify(body));

    // 验证基本结构
    if (body.ec !== 200 || !body.data) {
      console.log("Invalid webhook data, ec:", body.ec);
      return new Response(JSON.stringify({ ec: 200 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { type, order } = body.data;

    if (type !== "order" || !order) {
      console.log("Not an order event, type:", type);
      return new Response(JSON.stringify({ ec: 200 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 检查支付状态 (status=2 表示已支付)
    if (order.status !== 2) {
      console.log("Order not paid, status:", order.status);
      return new Response(JSON.stringify({ ec: 200 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 提取关键信息
    const afdianOrderId = order.out_trade_no || "";
    const afdianUserId = order.user_id || "";
    const planId = order.plan_id || "";
    const customOrderId = order.custom_order_id || ""; // Supabase user ID
    const month = order.month || 1;
    const totalAmount = order.total_amount || "0";
    const remark = order.remark || "";

    console.log("Order details:", {
      afdianOrderId,
      afdianUserId,
      planId,
      customOrderId,
      month,
      totalAmount,
      remark,
    });

    // 确定订阅计划
    let plan = PLAN_MAP[planId];
    if (!plan) {
      plan = getPlanByAmount(totalAmount);
      console.log(`plan_id ${planId} not in PLAN_MAP, using amount-based: ${plan}`);
    }

    if (!plan) {
      console.error("Cannot determine plan for amount:", totalAmount);
      return new Response(JSON.stringify({ ec: 200 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 获取 Supabase user ID
    // 优先从 custom_order_id 获取，其次从 remark 解析
    let supabaseUserId = customOrderId;
    if (!supabaseUserId && remark) {
      // 尝试从 remark 解析 UUID 格式
      const uuidMatch = remark.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
      );
      if (uuidMatch) {
        supabaseUserId = uuidMatch[0];
      }
    }

    if (!supabaseUserId) {
      console.error("Cannot determine Supabase user ID. custom_order_id:", customOrderId, "remark:", remark);
      // 仍然返回 200，避免爱发电重试
      return new Response(JSON.stringify({ ec: 200 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 初始化 Supabase 客户端（使用 service_role 绕过 RLS）
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 检查订单是否已处理（幂等性）
    const { data: existingOrder } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("afdian_order_id", afdianOrderId)
      .single();

    if (existingOrder) {
      console.log("Order already processed:", afdianOrderId);
      return new Response(JSON.stringify({ ec: 200 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 激活订阅
    const { data: result, error: rpcError } = await supabase.rpc(
      "activate_subscription",
      {
        p_user_id: supabaseUserId,
        p_plan: plan,
        p_months: month,
        p_afdian_user_id: afdianUserId,
        p_afdian_order_id: afdianOrderId,
      }
    );

    if (rpcError) {
      console.error("Failed to activate subscription:", rpcError);
      return new Response(JSON.stringify({ ec: 200 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Subscription activated! user: ${supabaseUserId}, plan: ${plan}, months: ${month}`);

    return new Response(JSON.stringify({ ec: 200 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error processing afdian webhook:", error);
    // 始终返回 200，避免爱发电不断重试
    return new Response(JSON.stringify({ ec: 200 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
