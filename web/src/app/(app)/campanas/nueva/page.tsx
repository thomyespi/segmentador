import { requireUser } from "@/lib/auth";
import { NewCampaignForm } from "./new-campaign-form";

export default async function NewCampaignPage() {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("contact_facets");
  if (error) throw new Error(error.message);
  const facets = data as { field: string; value: string; total: number }[];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Nueva campaña</h1>
      <NewCampaignForm
        rubros={facets.filter((f) => f.field === "rubro" && f.value)}
        zonas={facets.filter((f) => f.field === "zona" && f.value)}
      />
    </div>
  );
}
