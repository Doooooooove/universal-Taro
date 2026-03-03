import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import md5 from "https://esm.sh/blueimp-md5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 验证虎皮椒回调签名
function verifyHash(params: Record<string, string>, appSecret: string): boolean {
  const receivedHash = params.hash;

  // 过滤空值和 hash 字段，按 key 排序
  const sortedKeys = Object.keys(params)
    .filter((k) => k !== "hash" && params[k] !== "" && params[k] !== undefined)
    .sort();

  const stringA = sortedKeys.map((k) => `${k}=${params[k]}`).join("&");
  const calculatedHash = md5(stringA + appSecret);

  console.log("=== VERIFY HASH DEBUG ===");
  console.log("stringA:", stringA);
  console.log("calculatedHash:", calculatedHash);
  console.log("receivedHash:", receivedHash);

  return calculatedHash.toLowerCase() === receivedHash.toLowerCase();
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 虎皮椒回调是 POST form 表单
    let params: Record<string, string> = {};

    if (req.method === "GET") {
      const url = new URL(req.url);
      url.searchParams.forEach((value, key) => {
        params[key] = value;
      });
    } else {
      const formData = await req.formData();
      formData.forEach((value, key) => {
        params[key] = String(value);
      });
    }

    console.log("Received hupijiao notify:", params);

    // 获取配置
    const HUPIJIAO_APPSECRET = Deno.env.get("HUPIJIAO_APPSECRET");
    if (!HUPIJIAO_APPSECRET) {
      console.error("HUPIJIAO_APPSECRET not configured");
      return new Response("fail", { status: 500 });
    }

    // 验证签名
    const isValid = verifyHash(params, HUPIJIAO_APPSECRET.trim());
    if (!isValid) {
      console.error("Invalid hash signature");
      return new Response("fail", { status: 400 });
    }

    // 检查交易状态 - 虎皮椒用 status=OD 表示支付成功
    if (params.status !== "OD") {
      console.log("Trade not success, status:", params.status);
      return new Response("success");
    }

    // 虎皮椒字段: trade_order_id = 商户订单号, open_order_id = 虎皮椒内部订单号
    const outTradeNo = params.trade_order_id;
    const tradeNo = params.open_order_id || params.transaction_id || "";

    // 初始化 Supabase 客户端（使用 service_role 才能绕过 RLS）
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 查询订单
    const { data: order, error: orderError } = await supabase
      .from("payment_orders")
      .select("*")
      .eq("out_trade_no", outTradeNo)
      .single();

    if (orderError || !order) {
      console.error("Order not found:", outTradeNo);
      return new Response("fail", { status: 404 });
    }

    // 检查是否已处理
    if (order.status === "paid") {
      console.log("Order already paid:", outTradeNo);
      return new Response("success");
    }

    // 更新订单状态
    const { error: updateError } = await supabase
      .from("payment_orders")
      .update({
        status: "paid",
        trade_no: tradeNo,
        paid_at: new Date().toISOString(),
        notify_data: params,
      })
      .eq("out_trade_no", outTradeNo);

    if (updateError) {
      console.error("Failed to update order:", updateError);
      return new Response("fail", { status: 500 });
    }

    // 给用户加币
    const { error: rechargeError } = await supabase.rpc("process_recharge", {
      p_user_id: order.user_id,
      p_coins: order.coins,
      p_bonus: order.bonus,
      p_reference_id: outTradeNo,
    });

    if (rechargeError) {
      console.error("Failed to process recharge:", rechargeError);
      return new Response("fail", { status: 500 });
    }

    console.log("Payment success for order:", outTradeNo);
    return new Response("success");
    
  } catch (error) {
    console.error("Error processing hupijiao notify:", error);
    return new Response("fail", { status: 500 });
  }
});
