import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const TIER_MAP: Record<string, string> = {
  free: "Free",
  fan: "Fan",
  superfan: "Super Fan",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const email = (body.email || "").trim().toLowerCase();
    const name = (body.name || "").trim();
    const tierKey = (body.tier || "free").toLowerCase();
    const notes = body.notes || "";

    if (!email || !email.includes("@")) {
      return new Response(JSON.stringify({ error: "Valid email required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tier = TIER_MAP[tierKey] || "Free";

    // Avoid duplicate subscriber records for the same email
    const existing = await base44.asServiceRole.entities.Subscriber.filter({ email });
    if (existing && existing.length > 0) {
      const record = existing[0];
      // Upgrade tier / reactivate if needed, but don't spam a new welcome email
      const updates: Record<string, unknown> = {};
      if (tier !== "Free" && record.tier !== tier) updates.tier = tier;
      if (!record.active) updates.active = true;
      if (Object.keys(updates).length > 0) {
        await base44.asServiceRole.entities.Subscriber.update(record.id, updates);
      }
      return new Response(JSON.stringify({ success: true, status: "existing" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await base44.asServiceRole.entities.Subscriber.create({
      email,
      name: name || email.split("@")[0],
      tier,
      active: true,
      notes,
    });

    return new Response(JSON.stringify({ success: true, status: "created" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Subscribe error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
