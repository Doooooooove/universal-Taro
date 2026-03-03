import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import md5 from "https://esm.sh/blueimp-md5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 虎皮椒签名生成
function generateHash(params: Record<string, string>, appSecret: string): string {
  const sortedKeys = Object.keys(params)
    .filter((k) => k !== "hash" && params[k] !== "" && params[k] !== undefined)
    .sort();

  const stringA = sortedKeys.map((k) => `${k}=${params[k]}`).join("&");
  const hash = md5(stringA + appSecret);
  console.log("=== HASH DEBUG ===");
  console.log("sortedKeys:", sortedKeys);
  console.log("stringA:", stringA);
  console.log("hash:", hash);
  return hash;
}

// 生成订单号
function generateOutTradeNo(): string {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `TAROT${timestamp}${random}`;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 验证用户身份
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 初始化 Supabase 客户端
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // 用用户 token 获取用户信息
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid user" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 解析请求体
    const { itemId, amount, coins, bonus, payType } = await req.json();
    
    if (!amount || !coins) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 获取虎皮椒支付配置
    const HUPIJIAO_APPID = Deno.env.get("HUPIJIAO_APPID");
    const HUPIJIAO_APPSECRET = Deno.env.get("HUPIJIAO_APPSECRET");
    const HUPIJIAO_API_URL = Deno.env.get("HUPIJIAO_API_URL") || "https://api.xunhupay.com/payment/do.html";
    const NOTIFY_URL = `${supabaseUrl}/functions/v1/epay-notify`;
    const RETURN_URL = Deno.env.get("EPAY_RETURN_URL") || "http://tarott.zeabur.app/#/payment/result";

    if (!HUPIJIAO_APPID || !HUPIJIAO_APPSECRET) {
      console.error("Hupijiao config not set");
      return new Response(
        JSON.stringify({ error: "Payment not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 生成订单号
    const outTradeNo = generateOutTradeNo();

    // 使用 service_role 创建订单记录
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    const { error: insertError } = await supabaseAdmin
      .from("payment_orders")
      .insert({
        user_id: user.id,
        out_trade_no: outTradeNo,
        amount: amount,
        coins: coins,
        bonus: bonus || 0,
        pay_type: payType || "alipay",
      });

    if (insertError) {
      console.error("Failed to create order:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create order", detail: insertError.message, code: insertError.code }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 构建虎皮椒支付请求参数
    const hupiParams: Record<string, string> = {
      version: "1.1",
      appid: HUPIJIAO_APPID,
      trade_order_id: outTradeNo,
      total_fee: amount.toFixed(2),
      title: `Tarot Coins Recharge ${coins}`,
      time: Math.floor(Date.now() / 1000).toString(),
      notify_url: NOTIFY_URL,
      return_url: RETURN_URL,
      nonce_str: Math.random().toString(36).substring(2, 15),
    };

    // 微信支付需要传 type=WAP
    if (payType === "wxpay" || payType === "wechat") {
      hupiParams.type = "WAP";
    }

    // 生成签名
    const hash = generateHash(hupiParams, HUPIJIAO_APPSECRET.trim());
    hupiParams.hash = hash;

    console.log("Sending request to Hupijiao:", HUPIJIAO_API_URL);

    // POST 请求虎皮椒 API
    const formBody = new URLSearchParams(hupiParams).toString();
    const response = await fetch(HUPIJIAO_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody,
    });

    const result = await response.json();
    console.log("Hupijiao response:", result);

    if (result.errcode !== 0) {
      console.error("Hupijiao error:", result.errmsg);
      return new Response(
        JSON.stringify({ error: "Payment gateway error", detail: result.errmsg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 返回支付链接
    return new Response(
      JSON.stringify({ 
        success: true, 
        payUrl: result.url,
        outTradeNo,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error creating order:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
